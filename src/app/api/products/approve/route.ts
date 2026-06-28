// src/app/api/products/approve/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { publishToTelegram } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { productId } = body;

    if (!productId) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: productId' },
        { status: 400 }
      );
    }

    // 1. Fetch product
    const product = await prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      return NextResponse.json(
        { success: false, error: 'Product not found' },
        { status: 404 }
      );
    }

    // 2. Publish to Telegram
    const publishResult = await publishToTelegram(productId, product.channelId);

    if (publishResult.success) {
      return NextResponse.json({
        success: true,
        messageId: publishResult.messageId,
      });
    } else {
      return NextResponse.json(
        { success: false, error: publishResult.error || 'Failed to publish to Telegram' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Approve product API endpoint exception:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: (error as Error).message || 'Product approval execution failed' 
      },
      { status: 500 }
    );
  }
}
