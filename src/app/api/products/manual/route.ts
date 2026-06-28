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
  if (/^\d+$/.test(cleanInput)) {
    return cleanInput;
  }
  
  // Extract number from /item/12345.html or /item/12345 or similar patterns
  const match = cleanInput.match(/\/item\/(\d+)\.html/i) || 
                cleanInput.match(/\/item\/(\d+)\b/i) || 
                cleanInput.match(/\/(\d+)\.html/i);
  return match ? match[1] : null;
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

    // 1. Resolve redirect if it's a short link (s.click.aliexpress / a.aliexpress)
    let targetUrl = url.trim();
    if (targetUrl.includes('s.click.aliexpress.com') || targetUrl.includes('a.aliexpress.com')) {
      try {
        const res = await fetch(targetUrl, { method: 'GET', redirect: 'follow' });
        targetUrl = res.url;
      } catch (err) {
        console.error('Failed to resolve short URL redirect:', err);
      }
    }

    // 2. Extract product ID
    const productId = extractAliExpressProductId(targetUrl);
    if (!productId) {
      return NextResponse.json(
        { success: false, error: 'כתובת ה-URL אינה תקינה או שלא ניתן לחלץ מזהה מוצר של AliExpress' },
        { status: 400 }
      );
    }

    // 3. Query details from AliExpress
    const fields = [
      'product_id', 'product_title', 'sale_price', 'original_price',
      'discount', 'product_main_image_url', 'commission_rate',
      'evaluate_rate', 'product_detail_url', 'lastest_volume',
    ].join(',');

    let rawResponse;
    try {
      rawResponse = await callAliExpress('aliexpress.affiliate.product.detail.get', {
        product_ids: productId,
        fields,
      });
    } catch (aliError) {
      console.warn('aliexpress.affiliate.product.detail.get failed, trying fallback query:', (aliError as Error).message);
      // Fallback query method
      rawResponse = await callAliExpress('aliexpress.affiliate.product.query', {
        product_ids: productId,
        fields,
        page_size: '1',
        page_no: '1',
      });
    }

    const item = rawResponse?.aliexpress_affiliate_product_detail_get_response?.resp_result?.result?.products?.product?.[0] ||
                 rawResponse?.aliexpress_affiliate_product_query_response?.resp_result?.result?.products?.product?.[0];

    if (!item) {
      return NextResponse.json(
        { success: false, error: 'המוצר לא נמצא ב-AliExpress. אנא ודא שהמזהה תקין ופעיל באפיליאייט.' },
        { status: 404 }
      );
    }

    // 4. Parse AliExpress values
    const commissionRate = parseFloat(String(item.commission_rate || 0));
    const rating = parseFloat(String(item.evaluate_rate || 0));
    const salesCount = parseInt(String(item.lastest_volume || 0)) || 0;
    const discountPercent = parseInt(String(item.discount || 0).replace('%', '')) || 0;

    // 5. Generate monetize link
    let affiliateLink = item.product_detail_url || '';
    try {
      if (item.product_detail_url) {
        affiliateLink = await generateAffiliateLink(item.product_detail_url);
      }
    } catch (linkError) {
      console.warn('Manual monetization failed:', (linkError as Error).message);
    }

    const productData = {
      aliexpressProductId: String(item.product_id),
      titleOriginal: item.product_title || 'AliExpress Product',
      priceOriginal: parseFloat(String(item.original_price || 0)) || 0,
      priceDiscounted: parseFloat(String(item.sale_price || 0)) || 0,
      discountPercent,
      imageUrl: item.product_main_image_url || '',
      categoryId: '',
      commissionRate,
      rating,
      salesCount,
      status: 'pending',
      channelId,
      affiliateLink,
    };

    // 6. Upsert the product
    const product = await prisma.product.upsert({
      where: { aliexpressProductId: String(item.product_id) },
      update: {
        ...productData,
        titleHe: null,
        bodyHe: null,
        bulletsHe: null,
        ctaHe: null,
      },
      create: productData,
    });

    // 7. Run AI Content Generation
    const aiResult = await generateContent(product.id);

    if (aiResult.status === 'failed') {
      return NextResponse.json({
        success: false,
        error: aiResult.error || 'יצירת קופי שיווקי באמצעות AI נכשלה.',
        productId: product.id,
      });
    }

    // Load final DB model with Hebrew copywriting
    const finalProduct = await prisma.product.findUnique({
      where: { id: product.id },
    });

    return NextResponse.json({
      success: true,
      product: finalProduct,
    });
  } catch (error) {
    console.error('Manual product add endpoint error:', error);
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'כשל בלתי צפוי בעיבוד המוצר' },
      { status: 500 }
    );
  }
}
