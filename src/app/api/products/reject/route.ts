// src/app/api/products/reject/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

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

    // Update product status to 'rejected'
    await prisma.product.update({
      where: { id: productId },
      data: { status: 'rejected' },
    });

    return NextResponse.json({
      success: true,
      message: 'Product rejected successfully',
    });
  } catch (error) {
    console.error('Reject product API endpoint exception:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: (error as Error).message || 'Product rejection execution failed' 
      },
      { status: 500 }
    );
  }
}
