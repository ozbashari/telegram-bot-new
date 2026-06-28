// src/app/api/telegram/test/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { sendTelegramTest } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { channelId } = body;

    if (!channelId) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: channelId' },
        { status: 400 }
      );
    }

    const result = await sendTelegramTest(channelId);

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: 'Test message sent successfully',
      });
    } else {
      return NextResponse.json(
        { success: false, error: result.error || 'Failed to send test message' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Test API route exception:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: (error as Error).message || 'Telegram test execution failed' 
      },
      { status: 500 }
    );
  }
}
