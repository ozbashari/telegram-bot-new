// src/app/api/products/scan/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { scanProducts } from '@/lib/discovery';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

async function getCronSecret(): Promise<string> {
  try {
    const setting = await prisma.setting.findUnique({ where: { key: 'cron_secret' } });
    return setting?.value || process.env.CRON_SECRET || '';
  } catch {
    return process.env.CRON_SECRET || '';
  }
}

export async function POST(req: NextRequest) {
  const cronSecret = await getCronSecret();
  if (cronSecret) {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');
    if (token !== cronSecret) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

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
