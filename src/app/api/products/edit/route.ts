// src/app/api/products/edit/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { productId, titleHe, bodyHe, bulletsHe, ctaHe } = body;

    if (!productId) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: productId' },
        { status: 400 }
      );
    }

    const bulletsStr = typeof bulletsHe === 'string' 
      ? bulletsHe 
      : JSON.stringify(bulletsHe || []);

    // Update the product record with modified Hebrew copy fields
    await prisma.product.update({
      where: { id: productId },
      data: {
        titleHe,
        bodyHe,
        bulletsHe: bulletsStr,
        ctaHe,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Product copy updated successfully',
    });
  } catch (error) {
    console.error('Edit product API endpoint exception:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: (error as Error).message || 'Product edit execution failed' 
      },
      { status: 500 }
    );
  }
}
