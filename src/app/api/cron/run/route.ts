// src/app/api/cron/run/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { runOrchestrator } from '@/lib/scheduler';

export const dynamic = 'force-dynamic';

async function handleCronRun(req: NextRequest) {
  try {
    const dbSettings = await prisma.setting.findMany();
    const settingsMap = new Map(dbSettings.map((s: { key: string; value: string }) => [s.key, s.value]));
    const cronSecret = settingsMap.get('cron_secret') || process.env.CRON_SECRET;

    // Vercel's own cron sends x-vercel-cron:1 header (no Authorization).
    // GitHub Actions sends Authorization: Bearer <secret>.
    // Allow both; only reject if secret is configured AND neither condition matches.
    const isVercelCron = req.headers.get('x-vercel-cron') === '1';
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');
    const isValidToken = !cronSecret || token === cronSecret;

    if (!isVercelCron && !isValidToken) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const result = await runOrchestrator();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Cron job endpoint failed:', error);
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'Cron job execution failed' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) { return handleCronRun(req); }
export async function POST(req: NextRequest) { return handleCronRun(req); }
