// src/lib/scheduler.ts
import { prisma } from './db';
import { scanProducts } from './discovery';
import { generateContent } from './ai-generator';
import { publishToTelegram } from './telegram';

export interface OrchestrationResult {
  success: boolean;
  scanResult?: {
    scanned: number;
    new: number;
    duplicates: number;
    errors: string[];
  };
  generatedCount: number;
  publishedCount: number;
  publishedDetails: Array<{ productId: string; channelId: string; title: string }>;
  errors: string[];
}

/**
 * Orchestrates the full automatic flow:
 * 1. Scans new products from AliExpress & converts to affiliate links.
 * 2. Generates Hebrew copywriting using Gemini for pending products lacking it.
 * 3. Evaluates active channels and publishes the oldest pending product to Telegram if the interval allows.
 */
const MAX_AI_PER_RUN = 10;

export async function runOrchestrator(): Promise<OrchestrationResult> {
  const errors: string[] = [];
  let scanResult;
  let generatedCount = 0;
  let publishedCount = 0;
  const publishedDetails: Array<{ productId: string; channelId: string; title: string }> = [];

  // Step 1: Scan products from AliExpress
  try {
    scanResult = await scanProducts();
    if (scanResult.errors && scanResult.errors.length > 0) {
      errors.push(...scanResult.errors);
    }
  } catch (error) {
    const errorMsg = `Discovery scanning failed: ${(error as Error).message || String(error)}`;
    console.error(errorMsg);
    errors.push(errorMsg);
  }

  // Step 2: Generate Hebrew copywriting for pending products that lack copy
  try {
    const productsToGenerate = await prisma.product.findMany({
      where: {
        status: 'pending',
        OR: [
          { titleHe: null },
          { titleHe: '' },
        ],
      },
      take: MAX_AI_PER_RUN, // Limit per cron run to avoid Gemini quota exhaustion
      orderBy: { createdAt: 'asc' },
    });

    for (const product of productsToGenerate) {
      try {
        const genResult = await generateContent(product.id);
        if (genResult.status === 'success') {
          generatedCount++;
        } else if (genResult.error) {
          errors.push(`AI Generation failed for product ${product.id}: ${genResult.error}`);
        }
      } catch (genError) {
        const errorMsg = `AI Generation exception for product ${product.id}: ${(genError as Error).message || String(genError)}`;
        console.error(errorMsg);
        errors.push(errorMsg);
      }
    }
  } catch (error) {
    const errorMsg = `AI Generation batch processing failed: ${(error as Error).message || String(error)}`;
    console.error(errorMsg);
    errors.push(errorMsg);
  }

  // Step 3: Handle publishing logic for active channels with autoPublish enabled
  try {
    const activeChannels = await prisma.channel.findMany({
      where: { isActive: true },
    });

    const now = new Date();

    for (const channel of activeChannels) {
      if (!channel.autoPublish) {
        continue;
      }

      // Check publish interval constraint
      const lastPublished = channel.lastPublishedAt;
      const intervalMs = channel.publishIntervalHours * 60 * 60 * 1000;
      const shouldPublish = !lastPublished || (now.getTime() - lastPublished.getTime() >= intervalMs);

      if (!shouldPublish) {
        console.log(`Channel "${channel.name}" skip publish: last published at ${lastPublished ? lastPublished.toISOString() : 'never'}, interval ${channel.publishIntervalHours}h`);
        continue;
      }

      // Select oldest ready product (pending with copy, or failed with retries left)
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prismaAny = prisma as any;
        const nextProduct = await prismaAny.product.findFirst({
          where: {
            channelId: channel.id,
            OR: [
              { status: 'pending', titleHe: { not: null }, NOT: { titleHe: '' } },
              { status: 'publish_failed', retryCount: { lt: 3 }, titleHe: { not: null } },
            ],
          },
          orderBy: { createdAt: 'asc' },
        });

        if (nextProduct) {
          const pubResult = await publishToTelegram(nextProduct.id, channel.id);
          if (pubResult.success) {
            publishedCount++;
            publishedDetails.push({
              productId: nextProduct.id,
              channelId: channel.id,
              title: nextProduct.titleHe || nextProduct.titleOriginal,
            });
          } else {
            const errorMsg = `Telegram publishing failed for product ${nextProduct.id} on channel "${channel.name}": ${pubResult.error || 'Unknown error'}`;
            console.error(errorMsg);
            errors.push(errorMsg);
            // Track failure for retry
            const currentRetry: number = nextProduct.retryCount ?? 0;
            await prismaAny.product.update({
              where: { id: nextProduct.id },
              data: {
                status: currentRetry + 1 >= 3 ? 'rejected' : 'publish_failed',
                retryCount: { increment: 1 },
                lastError: pubResult.error || 'Unknown Telegram error',
              },
            });
          }
        } else {
          console.log(`No pending generated products available for channel "${channel.name}"`);
        }
      } catch (pubErr) {
        const errorMsg = `Publishing processing exception on channel "${channel.name}": ${(pubErr as Error).message || String(pubErr)}`;
        console.error(errorMsg);
        errors.push(errorMsg);
      }
    }
  } catch (error) {
    const errorMsg = `Publishing pipeline failure: ${(error as Error).message || String(error)}`;
    console.error(errorMsg);
    errors.push(errorMsg);
  }

  return {
    success: errors.length === 0,
    scanResult,
    generatedCount,
    publishedCount,
    publishedDetails,
    errors,
  };
}
