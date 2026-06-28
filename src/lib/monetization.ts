// src/lib/monetization.ts
import { prisma } from './db';
import { callAliExpress } from './aliexpress-client';

/**
 * Generates an affiliate link for a given AliExpress product URL.
 * Falls back to manual tracking query parameters if the API call fails.
 */
export async function generateAffiliateLink(productDetailUrl: string): Promise<string> {
  // Load tracking ID from settings
  let trackingId = 'default';
  try {
    const dbSettings = await prisma.setting.findMany();
    const settingsMap = new Map(dbSettings.map(s => [s.key, s.value]));
    trackingId = settingsMap.get('aliexpress_tracking_id') || process.env.ALIEXPRESS_TRACKING_ID || 'default';
  } catch (dbError) {
    console.error('Failed to load tracking ID from settings, using fallback default:', dbError);
    trackingId = process.env.ALIEXPRESS_TRACKING_ID || 'default';
  }

  try {
    // Request promotion link from AliExpress API
    const response = await callAliExpress('aliexpress.affiliate.link.generate', {
      promotion_link_type: '0', // 0 = Standard, 2 = App Deep Link
      source_values: productDetailUrl,
      tracking_id: trackingId,
    });

    const result = response?.aliexpress_affiliate_link_generate_response?.resp_result?.result;
    const promotionLink = result?.promotion_links?.promotion_link?.[0]?.promotion_link;

    if (promotionLink) {
      return promotionLink;
    }

    throw new Error('No promotion link returned in the API response');
  } catch (error) {
    console.warn(`AliExpress link generation failed for URL: ${productDetailUrl}. Using fallback format. Error: ${(error as Error).message || error}`);
    
    // Fallback: append manual tracking parameters to original URL
    try {
      const urlObj = new URL(productDetailUrl);
      urlObj.searchParams.set('aff_platform', 'api-new');
      urlObj.searchParams.set('sk', trackingId);
      return urlObj.toString();
    } catch {
      return productDetailUrl;
    }
  }
}
