import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1. Run parallel DB queries for stats
    const [
      publishedToday,
      pendingCount,
      totalPublished,
      publishedProducts,
      botActiveSetting,
      recentPublished,
      channels,
    ] = await Promise.all([
      // Published today
      prisma.product.count({
        where: {
          status: 'published',
          publishedAt: { gte: today },
        },
      }),
      // Pending confirmation
      prisma.product.count({
        where: {
          status: 'pending',
        },
      }),
      // Total published
      prisma.product.count({
        where: {
          status: 'published',
        },
      }),
      // Select commission components for published products
      prisma.product.findMany({
        where: { status: 'published' },
        select: { priceDiscounted: true, commissionRate: true },
      }),
      // Bot active status
      prisma.setting.findUnique({
        where: { key: 'bot_active' },
      }),
      // 5 most recent published products
      prisma.product.findMany({
        where: { status: 'published' },
        orderBy: { publishedAt: 'desc' },
        take: 5,
        include: {
          channel: {
            select: { name: true },
          },
        },
      }),
      // Active channels and their pending product counts
      prisma.channel.findMany({
        include: {
          _count: {
            select: {
              products: {
                where: { status: 'pending' },
              },
            },
          },
        },
      }),
    ]);

    // 2. Compute estimated commission
    const estimatedCommission = publishedProducts.reduce((sum, p) => {
      const rate = p.commissionRate || 0;
      const price = p.priceDiscounted || 0;
      return sum + (price * (rate / 100));
    }, 0);

    const botActive = botActiveSetting ? botActiveSetting.value !== 'false' : true;

    // 3. Map channels summary
    const channelsSummary = channels.map(c => ({
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
        totalPublished,
        estimatedCommission: parseFloat(estimatedCommission.toFixed(2)),
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
