// src/lib/discovery.ts
import { prisma } from './db';
import { callAliExpress } from './aliexpress-client';
import { generateAffiliateLink } from './monetization';

const MAX_NEW_PER_SCAN = 10;
const DEFAULT_MIN_FEEDBACK_PCT = 80;

// Rotate sort orders to get product diversity across runs
const SORT_ORDERS = [
  'LAST_VOLUME_DESC',   // bestsellers
  'DISCOUNT_DESC',      // biggest discounts
  'SALE_PRICE_ASC',     // cheapest first
  'COMMISSION_RATE_DESC', // highest commission
];

export interface ScanResult {
  scanned: number;
  new: number;
  duplicates: number;
  errors: string[];
  // breakdown: why products were skipped
  filteredByCommission: number;
  filteredByRating: number;
  filteredBySales: number;
  filteredByDiscount: number;
  filteredByNoLink: number;
}

export async function scanProducts(): Promise<ScanResult> {
  const errors: string[] = [];
  let scanned = 0;
  let newProducts = 0;
  let duplicates = 0;
  let filteredByCommission = 0;
  let filteredByRating = 0;
  let filteredBySales = 0;
  let filteredByDiscount = 0;
  let filteredByNoLink = 0;

  try {
    const dbSettings = await prisma.setting.findMany();
    const settingsMap = new Map(dbSettings.map((s: { key: string; value: string }) => [s.key, s.value]));

    const botActive = settingsMap.get('bot_active') !== 'false';
    const minCommissionRate = parseFloat(settingsMap.get('min_commission_rate') || '2');
    const minFeedbackPct = parseFloat(settingsMap.get('min_rating') || String(DEFAULT_MIN_FEEDBACK_PCT));
    const minSales = parseInt(settingsMap.get('min_sales') || '10');
    const dedupDays = parseInt(settingsMap.get('dedup_days') || '30');
    const currentPage = parseInt(settingsMap.get('scan_page_offset') || '1');
    const nextPage = currentPage >= 40 ? 1 : currentPage + 1;

    // Rotate sort order based on page offset so each run fetches different products
    const sortOrder = SORT_ORDERS[(currentPage - 1) % SORT_ORDERS.length];

    if (!botActive) {
      return { scanned: 0, new: 0, duplicates: 0, errors: ['Bot Scan Engine is disabled.'], filteredByCommission: 0, filteredByRating: 0, filteredBySales: 0, filteredByDiscount: 0, filteredByNoLink: 0 };
    }

    const activeChannels = await prisma.channel.findMany({ where: { isActive: true } });
    if (activeChannels.length === 0) {
      return { scanned: 0, new: 0, duplicates: 0, errors: ['No active channels found.'], filteredByCommission: 0, filteredByRating: 0, filteredBySales: 0, filteredByDiscount: 0, filteredByNoLink: 0 };
    }

    // Pre-load recently seen products for dedup (avoid N+1)
    const cutOffDate = new Date();
    cutOffDate.setDate(cutOffDate.getDate() - dedupDays);
    const recentProducts = await prisma.product.findMany({
      where: { createdAt: { gte: cutOffDate } },
      select: { aliexpressProductId: true, channelId: true },
    });
    const existingSet = new Set(recentProducts.map(p => `${p.aliexpressProductId}_${p.channelId}`));

    // Shuffle channels to distribute discovery randomly across channels in each run
    const shuffledChannels = [...activeChannels].sort(() => Math.random() - 0.5);

    outerLoop:
    for (const channel of shuffledChannels) {
      let categoryIds: string[] = [];
      try {
        const parsed = JSON.parse(channel.categories || '[]');
        categoryIds = Array.isArray(parsed) ? parsed : [channel.categories];
      } catch {
        if (channel.categories) {
          categoryIds = channel.categories.split(',').map(c => c.trim()).filter(Boolean);
        }
      }

      if (categoryIds.length === 0) {
        errors.push(`Channel "${channel.name}" has no categories configured.`);
        continue;
      }

      // Shuffle category IDs to ensure we don't always hit the duplicate wall on the first category
      const shuffledCategories = [...categoryIds].sort(() => Math.random() - 0.5);

      for (const categoryId of shuffledCategories) {
        if (newProducts >= MAX_NEW_PER_SCAN) break outerLoop;

        try {
          const fields = [
            'product_id', 'product_title', 'sale_price', 'original_price',
            'discount', 'product_main_image_url', 'commission_rate',
            'evaluate_rate', 'product_detail_url', 'lastest_volume',
          ].join(',');

          const rawResponse = await callAliExpress('aliexpress.affiliate.product.query', {
            category_ids: categoryId,
            sort: sortOrder,
            fields,
            page_size: '50',
            page_no: String(currentPage),
            target_currency: 'USD',
            target_language: 'EN',
          });

          const rawProducts =
            rawResponse?.aliexpress_affiliate_product_query_response?.resp_result?.result?.products?.product || [];

          for (const item of rawProducts) {
            if (newProducts >= MAX_NEW_PER_SCAN) break;

            scanned++;

            const commissionRate = parseFloat(String(item.commission_rate || 0));
            const feedbackPct = parseFloat(String(item.evaluate_rate || 0));
            const salesCount = parseInt(String(item.lastest_volume || 0)) || 0;
            const discountStr = String(item.discount || '0').replace('%', '').trim();
            const discountPercent = parseInt(discountStr) || 0;

            // Filter with tracking
            if (commissionRate < minCommissionRate) { filteredByCommission++; continue; }
            if (feedbackPct < minFeedbackPct) { filteredByRating++; continue; }
            if (salesCount < minSales) { filteredBySales++; continue; }
            if (discountPercent <= 0) { filteredByDiscount++; continue; }

            const aliexpressProductId = String(item.product_id);
            const dedupKey = `${aliexpressProductId}_${channel.id}`;
            if (existingSet.has(dedupKey)) { duplicates++; continue; }

            let affiliateLink = '';
            try {
              if (item.product_detail_url) {
                affiliateLink = await generateAffiliateLink(item.product_detail_url);
              }
            } catch (linkError) {
              filteredByNoLink++;
              errors.push(`Affiliate link failed for ${item.product_id}: ${(linkError as Error).message}`);
              continue;
            }

            if (!affiliateLink) {
              filteredByNoLink++;
              errors.push(`Empty affiliate link for product ${item.product_id}`);
              continue;
            }

            try {
              await prisma.product.create({
                data: {
                  aliexpressProductId,
                  titleOriginal: item.product_title || 'AliExpress Product',
                  priceOriginal: parseFloat(String(item.original_price || 0)) || 0,
                  priceDiscounted: parseFloat(String(item.sale_price || 0)) || 0,
                  discountPercent,
                  imageUrl: item.product_main_image_url || '',
                  categoryId: String(categoryId),
                  commissionRate,
                  rating: feedbackPct,
                  salesCount,
                  status: 'pending',
                  channelId: channel.id,
                  affiliateLink,
                },
              });
              newProducts++;
              existingSet.add(dedupKey);
            } catch {
              duplicates++;
            }
          }
        } catch (catError) {
          const msg = `Error scanning category ${categoryId} for channel "${channel.name}": ${(catError as Error).message}`;
          errors.push(msg);
          console.error(msg);
        }
      }
    }

    // Advance page + sort rotation
    try {
      await prisma.setting.upsert({
        where: { key: 'scan_page_offset' },
        update: { value: String(nextPage) },
        create: { key: 'scan_page_offset', value: String(nextPage) },
      });
    } catch {
      // Non-critical
    }

  } catch (globalError) {
    const msg = `Global scan error: ${(globalError as Error).message}`;
    errors.push(msg);
    console.error(msg);
  }

  return { scanned, new: newProducts, duplicates, errors, filteredByCommission, filteredByRating, filteredBySales, filteredByDiscount, filteredByNoLink };
}
