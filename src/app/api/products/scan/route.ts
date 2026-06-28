// src/app/api/products/scan/route.ts
import { NextResponse } from 'next/server';
import { scanProducts } from '@/lib/discovery';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const result = await scanProducts();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('Scan endpoint failed:', error);
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'Scan failed' },
      { status: 500 }
    );
  }
}
