// src/app/api/products/bulk/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { publishToTelegram } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, productIds } = body as { action: string; productIds: string[] };

    if (!action || !Array.isArray(productIds) || productIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Missing action or productIds' },
        { status: 400 }
      );
    }

    if (action === 'reject') {
      // Bulk reject — single DB call
      const { count } = await prisma.product.updateMany({
        where: { id: { in: productIds } },
        data: { status: 'rejected' },
      });
      return NextResponse.json({ success: true, count });
    }

    if (action === 'publish') {
      // Bulk publish — sequential to avoid Telegram rate limits
      const results: { id: string; success: boolean; error?: string }[] = [];

      for (const productId of productIds) {
        try {
          const product = await prisma.product.findUnique({ where: { id: productId } });
          if (!product) {
            results.push({ id: productId, success: false, error: 'Product not found' });
            continue;
          }
          const result = await publishToTelegram(productId, product.channelId);
          results.push({ id: productId, success: result.success, error: result.error });

          // Small delay between publishes to respect Telegram rate limits
          if (productIds.indexOf(productId) < productIds.length - 1) {
            await new Promise(r => setTimeout(r, 600));
          }
        } catch (err) {
          results.push({ id: productId, success: false, error: (err as Error).message });
        }
      }

      const successCount = results.filter(r => r.success).length;
      return NextResponse.json({ success: true, successCount, total: productIds.length, results });
    }

    return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('Bulk action endpoint failed:', error);
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'Bulk action failed' },
      { status: 500 }
    );
  }
}
