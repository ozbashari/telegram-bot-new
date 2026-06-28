import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    const rawSettings = await prisma.setting.findMany();
    const settings: Record<string, string> = {};
    rawSettings.forEach((item: { key: string; value: string }) => {
      settings[item.key] = item.value;
    });
    const channels = await prisma.channel.findMany({ orderBy: { createdAt: 'desc' } });
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
      const upsertPromises = Object.entries(settingsData).map(([key, value]) =>
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
        const updated = await prisma.channel.update({
          where: { id },
          data: { name, telegramChatId, botToken, categories: categoriesStr, isActive: isActive ?? true, autoPublish: autoPublish ?? false, publishIntervalHours: Number(publishIntervalHours) || 6 },
        });
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
    return NextResponse.json({ success: false, error: (error as Error).message || 'Operation failed' }, { status: 500 });
  }
}
