import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

// Keys that should never be returned in plaintext
const SENSITIVE_KEYS = ['aliexpress_app_secret', 'gemini_api_key']; // cron_secret stays readable so frontend can auth scan/cron calls

export async function GET() {
  try {
    const rawSettings = await prisma.setting.findMany();
    const settings: Record<string, string> = {};
    rawSettings.forEach((item: { key: string; value: string }) => {
      // Return placeholder for sensitive keys so UI knows they're set without exposing value
      settings[item.key] = SENSITIVE_KEYS.includes(item.key)
        ? (item.value ? '••••••••' : '')
        : item.value;
    });
    if (process.env.CRON_SECRET && !settings['cron_secret']) {
      settings['cron_secret'] = process.env.CRON_SECRET!; // pass through for frontend auth
    }
    // Mask bot tokens in channels
    const rawChannels = await prisma.channel.findMany({ orderBy: { createdAt: 'desc' } });
    const channels = rawChannels.map((c: { botToken: string; [key: string]: unknown }) => ({
      ...c,
      botToken: c.botToken ? '••••••••' : '',
    }));
    return NextResponse.json({ success: true, settings, channels });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, data } = body;

    if (type === 'settings') {
      const settingsData = data as Record<string, string>;
      // Never overwrite sensitive keys with the masked placeholder value
      const upsertPromises = Object.entries(settingsData)
        .filter(([key, value]) => !(SENSITIVE_KEYS.includes(key) && value === '••••••••'))
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) =>
          prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } })
        );
      await Promise.all(upsertPromises);
      return NextResponse.json({ success: true, message: 'Settings saved' });
    }

    if (type === 'channel') {
      const { id, name, telegramChatId, botToken, categories, isActive, autoPublish, publishIntervalHours } = data;
      if (!name || !telegramChatId || !botToken) {
        return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
      }
      const categoriesStr = typeof categories === 'string' ? categories : JSON.stringify(categories || []);
      if (id) {
        const updated = await (async () => {
          // Only update botToken if a real value was provided (not the masked placeholder)
          const updateData: Record<string, unknown> = {
            name, telegramChatId, categories: categoriesStr,
            isActive: isActive ?? true, autoPublish: autoPublish ?? false,
            publishIntervalHours: Number(publishIntervalHours) || 6,
          };
          if (botToken && botToken !== '••••••••') {
            updateData.botToken = botToken;
          }
          return prisma.channel.update({ where: { id }, data: updateData });
        })()
        return NextResponse.json({ success: true, channel: updated });
      } else {
        const created = await prisma.channel.create({
          data: { name, telegramChatId, botToken, categories: categoriesStr, isActive: isActive ?? true, autoPublish: autoPublish ?? false, publishIntervalHours: Number(publishIntervalHours) || 6 },
        });
        return NextResponse.json({ success: true, channel: created });
      }
    }

    if (type === 'delete_channel') {
      const { id } = data;
      if (!id) return NextResponse.json({ success: false, error: 'Missing channel ID' }, { status: 400 });
      await prisma.$transaction([
        prisma.publishLog.deleteMany({ where: { channelId: id } }),
        prisma.product.deleteMany({ where: { channelId: id } }),
        prisma.channel.delete({ where: { id } }),
      ]);
      return NextResponse.json({ success: true, message: 'Channel deleted' });
    }

    return NextResponse.json({ success: false, error: 'Invalid action type' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'Settings operation failed' },
      { status: 500 }
    );
  }
}
