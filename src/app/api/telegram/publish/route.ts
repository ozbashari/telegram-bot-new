// src/app/api/telegram/publish/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { publishToTelegram } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { productId, channelId } = body;

    if (!productId || !channelId) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: productId, channelId' },
        { status: 400 }
      );
    }

    const result = await publishToTelegram(productId, channelId);

    if (result.success) {
      return NextResponse.json({
        success: true,
        messageId: result.messageId,
      });
    } else {
      return NextResponse.json(
        { success: false, error: result.error || 'Failed to publish to Telegram' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Publish API route exception:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: (error as Error).message || 'Telegram publishing execution failed' 
      },
      { status: 500 }
    );
  }
}
