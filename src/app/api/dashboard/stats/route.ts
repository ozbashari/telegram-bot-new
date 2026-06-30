import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1. Run parallel DB queries for stats
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      publishedToday,
      pendingCount,
      failedCount,
      totalPublished,
      publishedProducts,
      botActiveSetting,
      recentPublished,
      channels,
      realOrders,
    ] = await Promise.all([
      // Published today
      prisma.product.count({
        where: { status: 'published', publishedAt: { gte: today } },
      }),
      // Pending confirmation
      prisma.product.count({ where: { status: 'pending' } }),
      // Failed publish (with retries)
      prisma.product.count({ where: { status: 'publish_failed' } }),
      // Total published
      prisma.product.count({ where: { status: 'published' } }),
      // Commission aggregate — sum(price * rate/100) via raw query to avoid loading all rows
      prisma.$queryRawUnsafe('SELECT COALESCE(SUM("priceDiscounted" * "commissionRate" / 100.0), 0) AS estimated FROM "Product" WHERE status = \'published\''),
      // Bot active status
      prisma.setting.findUnique({ where: { key: 'bot_active' } }),
      // 5 most recent published products
      prisma.product.findMany({
        where: { status: 'published' },
        orderBy: { publishedAt: 'desc' },
        take: 5,
        include: { channel: { select: { name: true } } },
      }),
      // Active channels and pending counts
      prisma.channel.findMany({
        include: {
          _count: { select: { products: { where: { status: 'pending' } } } },
        },
      }),
      // Real orders last 30 days — graceful fallback if Order table not yet migrated
      (async () => {
        try {
          return await db.order.findMany({
            where: { orderCreatedAt: { gte: thirtyDaysAgo } },
            select: { commissionFee: true, orderStatus: true },
          });
        } catch { return []; }
      })(),
    ]);

    // 2. Compute commissions (result from $queryRawUnsafe returns array of rows)
    type EstRow = { estimated: string | number };
    const estimatedCommission = parseFloat(String((publishedProducts as EstRow[])[0]?.estimated ?? 0)) || 0;

    type OrderRow = { commissionFee: number; orderStatus: string };
    const realCommission = (realOrders as OrderRow[]).reduce((sum, o) => sum + o.commissionFee, 0);
    const realOrdersCount = realOrders.length;
    const completedOrdersCount = (realOrders as OrderRow[]).filter(o =>
      ['Buyer Confirmed Receipt', 'Payment Completed', 'Fund Transferred'].includes(o.orderStatus)
    ).length;

    const botActive = botActiveSetting ? botActiveSetting.value !== 'false' : true;

    // 3. Map channels summary
    const channelsSummary = (channels as { id: string; name: string; isActive: boolean; autoPublish: boolean; lastPublishedAt: Date | null; _count: { products: number } }[]).map(c => ({
      id: c.id,
      name: c.name,
      isActive: c.isActive,
      autoPublish: c.autoPublish,
      lastPublishedAt: c.lastPublishedAt,
      pendingCount: c._count.products,
    }));

    return NextResponse.json({
      success: true,
      stats: {
        publishedToday,
        pendingCount,
        failedCount,
        totalPublished,
        estimatedCommission: parseFloat(estimatedCommission.toFixed(2)), // hypothetical: sum(price*rate) per published product
        realCommission: parseFloat(realCommission.toFixed(2)),
        realOrdersCount,
        completedOrdersCount,
      },
      botActive,
      recentPublished,
      channelsSummary,
    });
  } catch (error) {
    console.error('Failed to retrieve dashboard stats:', error);
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'Failed to fetch dashboard metrics' },
      { status: 500 }
    );
  }
}
