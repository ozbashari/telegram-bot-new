// src/app/api/performance/route.ts
// Fetches click + order performance from AliExpress Affiliate API
import { NextRequest, NextResponse } from 'next/server';
import { callAliExpress } from '@/lib/aliexpress-client';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10); // yyyy-MM-dd
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const days = parseInt(searchParams.get('days') || '7');
    const refresh = searchParams.get('refresh') === 'true';

    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);

    let clicks = 0;
    let apiError: string | null = null;

    if (refresh) {
      // Try AliExpress traffic/performance report API
      try {
        const raw = await callAliExpress('aliexpress.affiliate.traffic.report', {
          start_time: formatDate(start),
          end_time: formatDate(end),
          page_size: '50',
          page_no: '1',
        });
        const result = raw?.aliexpress_affiliate_traffic_report_response?.resp_result?.result;
        if (result) {
          clicks = parseInt(String(result.total_click_count || 0)) || 0;
        }
      } catch {
        // Try alternative method name
        try {
          const raw2 = await callAliExpress('aliexpress.affiliate.report.request', {
            report_type: 'traffic',
            start_date: formatDate(start),
            end_date: formatDate(end),
          });
          const result2 = raw2?.aliexpress_affiliate_report_request_response?.resp_result?.result;
          if (result2) {
            clicks = parseInt(String(result2.click_count || result2.total_click || 0)) || 0;
          }
        } catch (err2) {
          apiError = (err2 as Error).message;
        }
      }
    }

    // Always return orders from DB (already cached)
    const since = new Date();
    since.setDate(since.getDate() - days);

    let orders: { commissionFee: number; orderStatus: string; paidAmount: number }[] = [];
    try {
      orders = await db.order.findMany({
        where: { orderCreatedAt: { gte: since } },
        select: { commissionFee: true, orderStatus: true, paidAmount: true },
      });
    } catch {
      // Order table not yet migrated — return zeros
    }

    const totalCommission = orders.reduce((s, o) => s + o.commissionFee, 0);
    const completedOrders = orders.filter(o =>
      ['Buyer Confirmed Receipt', 'Payment Completed', 'Fund Transferred'].includes(o.orderStatus)
    );
    const completedCommission = completedOrders.reduce((s, o) => s + o.commissionFee, 0);

    return NextResponse.json({
      success: true,
      period: { days, start: formatDate(start), end: formatDate(end) },
      clicks,
      clicksAvailable: clicks > 0,
      paidOrders: orders.length,
      completedOrders: completedOrders.length,
      paidEstimatedEarnings: parseFloat(totalCommission.toFixed(2)),
      completedEstimatedEarnings: parseFloat(completedCommission.toFixed(2)),
      apiError,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
