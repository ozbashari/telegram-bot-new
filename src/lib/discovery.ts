// src/lib/discovery.ts
import { prisma } from './db';
import { callAliExpress } from './aliexpress-client';
import { generateAffiliateLink } from './monetization';

const MAX_NEW_PER_SCAN = 10;

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
    const settingsMap = new Map(dbSettings.map(s => [s.key, s.value]));

    const botActive = settingsMap.get('bot_active') !== 'false';
    const minCommissionRate = parseFloat(settingsMap.get('min_commission_rate') || '2');
    const minRating = parseFloat(settingsMap.get('min_rating') || '4.0');
    const minSales = parseInt(settingsMap.get('min_sales') || '10');
    const dedupDays = parseInt(settingsMap.get('dedup_days') || '30');

    if (!botActive) {
      return { scanned: 0, new: 0, duplicates: 0, errors: ['Bot Scan Engine is disabled.'] };
    }

    const activeChannels = await prisma.channel.findMany({ where: { isActive: true } });

    if (activeChannels.length === 0) {
      return { scanned: 0, new: 0, duplicates: 0, errors: ['No active channels found.'] };
    }

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
            sort: 'SALE_PRICE_ASC',
            fields,
            page_size: '10',
            page_no: '1',
            target_currency: 'USD',
            target_language: 'EN',
          });

          const rawProducts =
            rawResponse?.aliexpress_affiliate_product_query_response?.resp_result?.result?.products?.product || [];

          for (const item of rawProducts) {
            if (newProducts >= MAX_NEW_PER_SCAN) break;

            scanned++;

            const commissionRate = parseFloat(String(item.commission_rate || 0));
            const rating = parseFloat(String(item.evaluate_rate || 0));
            const salesCount = parseInt(String(item.lastest_volume || 0)) || 0;
            const discountPercent = parseInt(String(item.discount || 0).replace('%', '')) || 0;

            if (commissionRate < minCommissionRate) continue;
            if (rating < minRating) continue;
            if (salesCount < minSales) continue;
            if (discountPercent <= 0) continue;

            const aliexpressProductId = String(item.product_id);
            const cutOffDate = new Date();
            cutOffDate.setDate(cutOffDate.getDate() - dedupDays);

            const existing = await prisma.product.findFirst({
              where: { aliexpressProductId, channelId: channel.id, createdAt: { gte: cutOffDate } },
            });

            if (existing) { duplicates++; continue; }

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
                  rating,
                  salesCount,
                  status: 'pending',
                  channelId: channel.id,
                  affiliateLink,
                },
              });
              newProducts++;
            } catch {
              // Likely a unique constraint violation (product exists in another channel)
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
  } catch (globalError) {
    const msg = `Global scan error: ${(globalError as Error).message}`;
    errors.push(msg);
    console.error(msg);
  }

  return { scanned, new: newProducts, duplicates, errors };
}
