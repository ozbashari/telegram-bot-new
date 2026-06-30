// src/lib/telegram.ts
import { Product } from '@prisma/client';
import { prisma } from './db';
import { escapeMarkdownV2 } from './markdown-escape';

const CAPTION_LIMIT = 1024; // Telegram sendPhoto caption limit

/**
 * Builds the post caption in Telegram's MarkdownV2 format.
 * Automatically truncates to stay within Telegram's 1024-char sendPhoto limit.
 */
export function buildCaption(product: Product): string {
  const title = escapeMarkdownV2(product.titleHe || product.titleOriginal);
  const body = escapeMarkdownV2(product.bodyHe || '');

  let bullets = '';
  try {
    if (product.bulletsHe) {
      const parsed = JSON.parse(product.bulletsHe);
      if (Array.isArray(parsed) && parsed.length > 0) {
        bullets = parsed.map((b: string) => `✅ ${escapeMarkdownV2(b)}`).join('\n');
      }
    }
  } catch {
    bullets = '';
  }

  const priceNew = escapeMarkdownV2(`$${product.priceDiscounted}`);
  const priceOld = escapeMarkdownV2(`$${product.priceOriginal}`);
  const discount = escapeMarkdownV2(String(product.discountPercent));
  const cta = escapeMarkdownV2(product.ctaHe || '');

  const rawLink = product.affiliateLink || product.imageUrl;
  const escapedLink = rawLink.replace(/([\)\\])/g, '\\$1');
  const linkSuffix = `\n\n*🛒 [לרכישה לחץ כאן](${escapedLink})*`;
  const pricePart = `\n\n💰 *מחיר: ${priceNew}* ~${priceOld}~\n🔥 חיסכון של ${discount}%`;
  const ctaPart = cta ? `\n\n${cta}` : '';

  // Build full caption
  let caption = `*${title}*\n\n${body}`;
  if (bullets) caption += `\n\n${bullets}`;
  caption += pricePart + ctaPart;

  // If exceeds limit, drop bullets first (they're optional)
  if (caption.length + linkSuffix.length > CAPTION_LIMIT && bullets) {
    caption = `*${title}*\n\n${body}` + pricePart + ctaPart;
  }

  // If still too long, truncate body to fit
  if (caption.length + linkSuffix.length > CAPTION_LIMIT) {
    const fixedLen = `*${title}*\n\n`.length + pricePart.length + ctaPart.length + linkSuffix.length + 2;
    const maxBodyLen = Math.max(0, CAPTION_LIMIT - fixedLen);
    const truncatedBody = body.slice(0, maxBodyLen) + (body.length > maxBodyLen ? '…' : '');
    caption = `*${title}*\n\n${truncatedBody}` + pricePart + ctaPart;
  }

  caption += linkSuffix;
  return caption;
}

/**
 * Publishes a product to a Telegram channel.
 * Implements fallback sendPhoto -> sendMessage textOnly + image link if photo loading fails.
 */
export async function publishToTelegram(
  productId: string,
  channelId: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    // 1. Fetch product and channel details
    const product = await prisma.product.findUnique({ where: { id: productId } });
    const channel = await prisma.channel.findUnique({ where: { id: channelId } });

    if (!product) {
      return { success: false, error: 'Product not found' };
    }
    if (!channel) {
      return { success: false, error: 'Channel not found' };
    }

    const captionText = buildCaption(product);
    const botToken = channel.botToken;
    const chatId = channel.telegramChatId;
    const affiliateUrl = product.affiliateLink || product.imageUrl;

    const inlineKeyboard = {
      inline_keyboard: [[
        {
          text: '🛒 לרכישה לחץ כאן',
          url: affiliateUrl,
        }
      ]]
    };

    // 2. Attempt to send photo
    const photoUrl = `https://api.telegram.org/bot${botToken}/sendPhoto`;
    let response = await fetch(photoUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        photo: product.imageUrl,
        caption: captionText,
        parse_mode: 'MarkdownV2',
        reply_markup: inlineKeyboard,
      }),
      cache: 'no-store',
    });

    let resultData = await response.json();

    if (response.ok && resultData?.ok) {
      const messageId = String(resultData?.result?.message_id || '');
      
      // Save logs and status in a transaction
      await prisma.$transaction([
        prisma.product.update({
          where: { id: productId },
          data: { status: 'published', publishedAt: new Date() },
        }),
        prisma.channel.update({
          where: { id: channelId },
          data: { lastPublishedAt: new Date() },
        }),
        prisma.publishLog.create({
          data: {
            productId,
            channelId,
            telegramMsgId: messageId,
            status: 'success',
          },
        }),
      ]);

      return { success: true, messageId };
    }

    // 3. Fallback: If sendPhoto failed, send message as textOnly with image link preview
    console.warn(`sendPhoto failed for product ${productId} on channel ${channel.name}. Error: ${resultData.description}. Retrying with sendMessage fallback.`);

    const textUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const photoLink = `[📸](${escapeMarkdownV2(product.imageUrl)})`;
    const textBody = `${photoLink}\n\n${captionText}`;

    response = await fetch(textUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: textBody,
        parse_mode: 'MarkdownV2',
        reply_markup: inlineKeyboard,
      }),
      cache: 'no-store',
    });

    resultData = await response.json();

    if (response.ok && resultData?.ok) {
      const messageId = String(resultData?.result?.message_id || '');
      
      // Save logs and status in a transaction
      await prisma.$transaction([
        prisma.product.update({
          where: { id: productId },
          data: { status: 'published', publishedAt: new Date() },
        }),
        prisma.channel.update({
          where: { id: channelId },
          data: { lastPublishedAt: new Date() },
        }),
        prisma.publishLog.create({
          data: {
            productId,
            channelId,
            telegramMsgId: messageId,
            status: 'success',
          },
        }),
      ]);

      return { success: true, messageId };
    }

    // 4. Log failure if both attempts fail
    const errorMsg = resultData?.description || 'Telegram API returned an error';
    console.error(`Telegram publishing failed for product ${productId}: ${errorMsg}`);

    await prisma.publishLog.create({
      data: {
        productId,
        channelId,
        status: 'failed',
        errorMessage: errorMsg,
      },
    });

    return { success: false, error: errorMsg };
  } catch (error) {
    const errorMsg = (error as Error).message || String(error);
    console.error('Fatal error during Telegram publishing execution:', error);

    try {
      await prisma.publishLog.create({
        data: {
          productId,
          channelId,
          status: 'failed',
          errorMessage: `Fatal execution error: ${errorMsg}`,
        },
      });
    } catch (dbErr) {
      console.error('Failed to write failure logs to DB:', dbErr);
    }

    return { success: false, error: errorMsg };
  }
}

/**
 * Sends a test connectivity handshake to a Telegram channel.
 */
export async function sendTelegramTest(
  channelId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const channel = await prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) {
      return { success: false, error: 'Channel not found' };
    }

    const testUrl = `https://api.telegram.org/bot${channel.botToken}/sendMessage`;
    const response = await fetch(testUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: channel.telegramChatId,
        text: '\u05d4\u05d1\u05d5\u05d8 \u05e4\u05e2\u05d9\u05dc \u2705',
      }),
      cache: 'no-store',
    });
    const data = await response.json();
    if (response.ok && data?.ok) {
      return { success: true };
    }

    return { success: false, error: data?.description || 'Failed to send test message' };
  } catch (error) {
    return { success: false, error: (error as Error).message || String(error) };
  }
}
