// src/app/api/products/manual/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { generateAffiliateLink } from '@/lib/monetization';
import { generateContent } from '@/lib/ai-generator';
import { callAliExpress } from '@/lib/aliexpress-client';

export const dynamic = 'force-dynamic';

/**
 * Extracts the AliExpress product ID from a variety of URL formats or raw product ID strings.
 */
function extractAliExpressProductId(input: string): string | null {
  const cleanInput = input.trim();

  // Raw numeric ID
  if (/^\d{10,20}$/.test(cleanInput)) return cleanInput;

  // Standard patterns: /item/12345.html  /item/12345  /12345.html
  const patterns = [
    /\/item\/(\d{10,20})\.html/i,
    /\/item\/(\d{10,20})/i,
    /[?&]productId=(\d{10,20})/i,
    /\/(\d{10,20})\.html/i,
    /\/(\d{10,20})(?:[/?#]|$)/i,
  ];
  for (const re of patterns) {
    const m = cleanInput.match(re);
    if (m) return m[1];
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const { url, channelId } = await req.json();

    if (!url || !channelId) {
      return NextResponse.json(
        { success: false, error: 'נא לספק קישור למוצר וערוץ יעד' },
        { status: 400 }
      );
    }

    // 1. Resolve short/redirect links (s.click, a.aliexpress, bit.ly, etc.)
    let targetUrl = url.trim();
    const isShortLink =
      targetUrl.includes('s.click.aliexpress.com') ||
      targetUrl.includes('a.aliexpress.com') ||
      targetUrl.includes('aliexpress.onelink') ||
      /https?:\/\/[^/]{1,20}\.[a-z]{2,4}\/[A-Za-z0-9_-]{4,15}$/.test(targetUrl);

    if (isShortLink) {
      try {
        const res = await fetch(targetUrl, {
          method: 'GET',
          redirect: 'follow',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml',
          },
        });
        if (res.url && res.url !== targetUrl) targetUrl = res.url;
      } catch (err) {
        console.warn('Failed to resolve redirect, trying original URL:', (err as Error).message);
      }
    }

    // 2. Extract product ID
    const productId = extractAliExpressProductId(targetUrl);
    if (!productId) {
      return NextResponse.json(
        {
          success: false,
          error: `לא הצלחנו לחלץ מזהה מוצר מהכתובת. נסה להדביק את כתובת המוצר המלאה (https://www.aliexpress.com/item/XXXXXXXX.html) או את המספר בלבד.`,
        },
        { status: 400 }
      );
    }

    // 3. Try fetching product details from AliExpress
    const fields = [
      'product_id', 'product_title', 'sale_price', 'original_price',
      'discount', 'product_main_image_url', 'commission_rate',
      'evaluate_rate', 'product_detail_url', 'lastest_volume',
    ].join(',');

    let item: Record<string, unknown> | null = null;
    let lastApiError = '';

    // Attempt 1: product.detail.get (direct lookup by ID)
    try {
      const raw = await callAliExpress('aliexpress.affiliate.product.detail.get', {
        product_ids: productId,
        fields,
      });
      const resp = raw?.aliexpress_affiliate_product_detail_get_response?.resp_result;
      if (resp?.resp_code === 200 || resp?.resp_code === '200') {
        item = resp?.result?.products?.product?.[0] ?? null;
      } else {
        lastApiError = `detail.get: code=${resp?.resp_code} msg=${resp?.resp_msg}`;
      }
    } catch (e) {
      lastApiError = `detail.get exception: ${(e as Error).message}`;
      console.warn(lastApiError);
    }

    // Attempt 2: product.query filtered by product_ids
    if (!item) {
      try {
        const raw2 = await callAliExpress('aliexpress.affiliate.product.query', {
          product_ids: productId,
          fields,
          page_size: '1',
          page_no: '1',
        });
        const resp2 = raw2?.aliexpress_affiliate_product_query_response?.resp_result;
        if (resp2?.resp_code === 200 || resp2?.resp_code === '200') {
          item = resp2?.result?.products?.product?.[0] ?? null;
        } else {
          lastApiError += ` | query: code=${resp2?.resp_code} msg=${resp2?.resp_msg}`;
        }
      } catch (e2) {
        lastApiError += ` | query exception: ${(e2 as Error).message}`;
        console.warn(lastApiError);
      }
    }

    // Attempt 3: keyword search by product ID as fallback
    if (!item) {
      try {
        const raw3 = await callAliExpress('aliexpress.affiliate.product.query', {
          keywords: productId,
          fields,
          page_size: '5',
          page_no: '1',
        });
        const resp3 = raw3?.aliexpress_affiliate_product_query_response?.resp_result;
        if (resp3?.resp_code === 200 || resp3?.resp_code === '200') {
          const products: Record<string, unknown>[] = resp3?.result?.products?.product ?? [];
          item = products.find((p) => String(p.product_id) === productId) ?? products[0] ?? null;
        } else {
          lastApiError += ` | keyword: code=${resp3?.resp_code} msg=${resp3?.resp_msg}`;
        }
      } catch (e3) {
        lastApiError += ` | keyword exception: ${(e3 as Error).message}`;
        console.warn(lastApiError);
      }
    }

    if (!item) {
      return NextResponse.json(
        {
          success: false,
          error: `המוצר לא נמצא ב-AliExpress Affiliate. ייתכן שהמוצר אינו זמין לאפיליאטים, או שהחשבון שלך אינו מאושר לקטגוריה זו.\n\nפרטי שגיאה: ${lastApiError}`,
        },
        { status: 404 }
      );
    }

    // 4. Parse values
    const commissionRate = parseFloat(String(item.commission_rate || 0));
    const rating = parseFloat(String(item.evaluate_rate || 0));
    const salesCount = parseInt(String(item.lastest_volume || 0)) || 0;
    const discountPercent = parseInt(String(item.discount || 0).replace('%', '')) || 0;

    // 5. Generate affiliate link
    let affiliateLink = String(item.product_detail_url || '');
    try {
      if (item.product_detail_url) {
        affiliateLink = await generateAffiliateLink(String(item.product_detail_url));
      }
    } catch (linkError) {
      console.warn('Manual monetization failed:', (linkError as Error).message);
    }

    const productData = {
      aliexpressProductId: String(item.product_id),
      titleOriginal: String(item.product_title || 'AliExpress Product'),
      priceOriginal: parseFloat(String(item.original_price || 0)) || 0,
      priceDiscounted: parseFloat(String(item.sale_price || 0)) || 0,
      discountPercent,
      imageUrl: String(item.product_main_image_url || ''),
      categoryId: '',
      commissionRate,
      rating,
      salesCount,
      status: 'pending',
      channelId,
      affiliateLink,
    };

    // 6. Upsert (compound key: aliexpressProductId + channelId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prismaAny = prisma as any;
    const product = await prismaAny.product.upsert({
      where: {
        aliexpressProductId_channelId: {
          aliexpressProductId: String(item.product_id),
          channelId,
        },
      },
      update: {
        ...productData,
        titleHe: null,
        bodyHe: null,
        bulletsHe: null,
        ctaHe: null,
        retryCount: 0,
        lastError: null,
      },
      create: productData,
    });

    // 7. Generate AI content
    const aiResult = await generateContent(product.id);
    if (aiResult.status === 'failed') {
      return NextResponse.json({
        success: false,
        error: aiResult.error || 'יצירת קופי שיווקי באמצעות AI נכשלה.',
        productId: product.id,
      });
    }

    const finalProduct = await prisma.product.findUnique({ where: { id: product.id } });
    return NextResponse.json({ success: true, product: finalProduct });
  } catch (error) {
    console.error('Manual product add endpoint error:', error);
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'כשל בלתי צפוי בעיבוד המוצר' },
      { status: 500 }
    );
  }
}
