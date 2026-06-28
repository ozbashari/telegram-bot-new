// src/app/api/products/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    
    const channelId = searchParams.get('channelId') || undefined;
    const status = searchParams.get('status') || undefined;
    const categoryId = searchParams.get('categoryId') || undefined;
    
    const limit = Math.min(
      Math.max(parseInt(searchParams.get('limit') || '50') || 50, 1),
      100
    );
    const offset = Math.max(parseInt(searchParams.get('offset') || '0') || 0, 0);

    // Build filters object
    const where: {
      channelId?: string;
      status?: string;
      categoryId?: string;
    } = {};

    if (channelId) where.channelId = channelId;
    if (status) where.status = status;
    if (categoryId) where.categoryId = categoryId;

    // Fetch products
    const products = await prisma.product.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        channel: {
          select: {
            id: true,
            name: true,
            telegramChatId: true,
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      products,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Failed to query products:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: (error as Error).message || 'Failed to query products' 
      },
      { status: 500 }
    );
  }
}
