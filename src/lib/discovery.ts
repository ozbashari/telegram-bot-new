// src/lib/discovery.ts
import { prisma } from './db';
import { callAliExpress } from './aliexpress-client';
import { generateAffiliateLink } from './monetization';

const MAX_NEW_PER_SCAN = 10;

// AliExpress evaluate_rate is a POSITIVE FEEDBACK PERCENTAGE (0-100), not a 5-star rating.
// Default min is 80% positive (good enough quality).
const DEFAULT_MIN_FEEDBACK_PCT = 80;

export interface ScanResult {
  scanned: number;
  new: number;
  duplicates: number;
  errors: string[];
}

export async function scanProducts(): Promise<ScanResult> {
  const errors: string[] = [];
  let scanned = 0;
  let newProducts = 0;
  let duplicates = 0;

  try {
    const dbSettings = await prisma.setting.findMany();
    const settingsMap = new Map(dbSettings.map((s: { key: string; value: string }) => [s.key, s.value]));

    const botActive = settingsMap.get('bot_active') !== 'false';
    const minCommissionRate = parseFloat(settingsMap.get('min_commission_rate') || '2');
    // evaluate_rate is feedback %, stored as 0-100. Default: 80% positive.
    const minFeedbackPct = parseFloat(settingsMap.get('min_rating') || String(DEFAULT_MIN_FEEDBACK_PCT));
    const minSales = parseInt(settingsMap.get('min_sales') || '10');
    const dedupDays = parseInt(settingsMap.get('dedup_days') || '30');
    // scan_page_offset rotates which page we fetch, so we don't always see the same products
    const currentPage = parseInt(settingsMap.get('scan_page_offset') || '1');
    const nextPage = currentPage >= 5 ? 1 : currentPage + 1; // Rotate pages 1-5

    if (!botActive) {
      return { scanned: 0, new: 0, duplicates: 0, errors: ['Bot Scan Engine is disabled.'] };
    }

    const activeChannels = await prisma.channel.findMany({ where: { isActive: true } });
    if (activeChannels.length === 0) {
      return { scanned: 0, new: 0, duplicates: 0, errors: ['No active channels found.'] };
    }

    // Pre-load recently seen products to avoid N+1 dedup queries
    const cutOffDate = new Date();
    cutOffDate.setDate(cutOffDate.getDate() - dedupDays);
    const recentProducts = await prisma.product.findMany({
      where: { createdAt: { gte: cutOffDate } },
      select: { aliexpressProductId: true, channelId: true },
    });
    const existingSet = new Set(recentProducts.map(p => `${p.aliexpressProductId}_${p.channelId}`));

    outerLoop:
    for (const channel of activeChannels) {
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

      for (const categoryId of categoryIds) {
        if (newProducts >= MAX_NEW_PER_SCAN) break outerLoop;

        try {
          const fields = [
            'product_id', 'product_title', 'sale_price', 'original_price',
            'discount', 'product_main_image_url', 'commission_rate',
            'evaluate_rate', 'product_detail_url', 'lastest_volume',
          ].join(',');

          const rawResponse = await callAliExpress('aliexpress.affiliate.product.query', {
            category_ids: categoryId,
            sort: 'LAST_VOLUME_DESC', // Sort by bestsellers — better commission & quality
            fields,
            page_size: '50',          // Fetch more to survive strict filters
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
            // evaluate_rate = positive feedback % (e.g. 97.3 means 97.3% positive reviews)
            const feedbackPct = parseFloat(String(item.evaluate_rate || 0));
            const salesCount = parseInt(String(item.lastest_volume || 0)) || 0;
            // discount may come as "10%" or "10" — strip % sign
            const discountStr = String(item.discount || '0').replace('%', '').trim();
            const discountPercent = parseInt(discountStr) || 0;

            if (commissionRate < minCommissionRate) continue;
            if (feedbackPct < minFeedbackPct) continue; // e.g. < 80%
            if (salesCount < minSales) continue;
            if (discountPercent <= 0) continue;

            const aliexpressProductId = String(item.product_id);
            const dedupKey = `${aliexpressProductId}_${channel.id}`;
            if (existingSet.has(dedupKey)) { duplicates++; continue; }

            let affiliateLink = item.product_detail_url || '';
            try {
              if (item.product_detail_url) {
                affiliateLink = await generateAffiliateLink(item.product_detail_url);
              }
            } catch (linkError) {
              console.warn('Link generation failed:', (linkError as Error).message);
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
                  rating: feedbackPct, // stored as 0-100 feedback %
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

    // Advance the page offset for next run (rotate 1→2→3→4→5→1)
    try {
      await prisma.setting.upsert({
        where: { key: 'scan_page_offset' },
        update: { value: String(nextPage) },
        create: { key: 'scan_page_offset', value: String(nextPage) },
      });
    } catch {
      // Non-critical — ignore
    }

  } catch (globalError) {
    const msg = `Global scan error: ${(globalError as Error).message}`;
    errors.push(msg);
    console.error(msg);
  }

  return { scanned, new: newProducts, duplicates, errors };
}
