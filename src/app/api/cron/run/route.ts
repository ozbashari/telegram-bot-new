// src/app/api/cron/run/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { runOrchestrator } from '@/lib/scheduler';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    // 1. Fetch CRON_SECRET security token from Settings table or process environment variables
    const dbSettings = await prisma.setting.findMany();
    const settingsMap = new Map(dbSettings.map(s => [s.key, s.value]));
    const cronSecret = settingsMap.get('cron_secret') || process.env.CRON_SECRET;

    // 2. Validate token if configured
    if (cronSecret) {
      const authHeader = req.headers.get('authorization');
      const token = authHeader?.replace('Bearer ', '');

      if (token !== cronSecret) {
        return NextResponse.json(
          { success: false, error: 'Unauthorized' },
          { status: 401 }
        );
      }
    } else {
      console.warn('CRON_SECRET is not configured in either settings or process environment variables.');
    }

    // 3. Trigger the full automation orchestrator
    const result = await runOrchestrator();

    return NextResponse.json(result);
  } catch (error) {
    console.error('Cron job endpoint failed:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: (error as Error).message || 'Cron job execution failed' 
      },
      { status: 500 }
    );
  }
}
