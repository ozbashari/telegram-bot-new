// src/app/api/orders/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { callAliExpress } from '@/lib/aliexpress-client';

export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

function formatDate(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

async function fetchAndCacheOrders(days = 30) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);

  let pageNo = 1;
  const pageSize = 50;
  let totalFetched = 0;

  while (true) {
    const raw = await callAliExpress('aliexpress.affiliate.order.list', {
      start_time_to_gmt: formatDate(start),
      end_time_to_gmt: formatDate(end),
      page_no: String(pageNo),
      page_size: String(pageSize),
    });

    const result = raw?.aliexpress_affiliate_order_list_response?.resp_result?.result;
    const orders: unknown[] = result?.orders?.order || [];
    if (!orders.length) break;

    for (const o of orders as Record<string, unknown>[]) {
      const commissionFee = parseFloat(String(o.commission_fee || 0)) || 0;
      const commissionRate = parseFloat(String(o.commission_rate || 0)) || 0;
      const paidAmount = parseFloat(String(o.paid_amount || 0)) || 0;
      const orderCreatedAt = o.order_create_time
        ? new Date(String(o.order_create_time).replace(' ', 'T') + 'Z')
        : new Date();

      await db.order.upsert({
        where: { aliOrderId: String(o.order_id) },
        update: { orderStatus: String(o.order_status || 'Unknown'), commissionFee, commissionRate, paidAmount },
        create: {
          aliOrderId: String(o.order_id),
          productTitle: o.product_title ? String(o.product_title) : null,
          orderStatus: String(o.order_status || 'Unknown'),
          commissionFee, commissionRate, paidAmount, orderCreatedAt,
        },
      });
      totalFetched++;
    }

    const totalCount = parseInt(String(result?.total_count || 0)) || 0;
    if (pageNo * pageSize >= totalCount) break;
    pageNo++;
  }

  return totalFetched;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const days = parseInt(searchParams.get('days') || '30');
    const refresh = searchParams.get('refresh') === 'true';

    if (refresh) {
      try { await fetchAndCacheOrders(days); } catch (e) {
        console.warn('fetchAndCacheOrders failed:', (e as Error).message);
      }
    }

    const since = new Date();
    since.setDate(since.getDate() - days);

    let orders: { commissionFee: number; paidAmount: number; orderStatus: string }[] = [];
    try { orders = await db.order.findMany({
      where: { orderCreatedAt: { gte: since } },
      orderBy: { orderCreatedAt: 'desc' },
      take: 200,
    }); } catch { /* Order table not yet created */ }

    const totalCommission = orders.reduce((s, o) => s + o.commissionFee, 0);
    const totalRevenue = orders.reduce((s, o) => s + o.paidAmount, 0);
    const completedOrders = orders.filter(o =>
      ['Buyer Confirmed Receipt', 'Payment Completed', 'Fund Transferred'].includes(o.orderStatus)
    );

    return NextResponse.json({
      success: true,
      orders,
      summary: {
        totalOrders: orders.length,
        completedOrders: completedOrders.length,
        totalCommission: parseFloat(totalCommission.toFixed(2)),
        totalRevenue: parseFloat(totalRevenue.toFixed(2)),
      },
    });
  } catch (error) {
    console.error('Orders API error:', error);
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'Failed to fetch orders' },
      { status: 500 }
    );
  }
}
