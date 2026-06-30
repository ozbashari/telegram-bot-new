// src/app/api/cron/review/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

async function handleReview(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const [
      publishedToday,
      pendingCount,
      failedCount,
      totalPublished,
      recentErrors,
      channels,
      topProducts,
      orders7d,
    ] = await Promise.all([
      db.product.count({ where: { status: 'published', publishedAt: { gte: today } } }),
      db.product.count({ where: { status: 'pending' } }),
      db.product.count({ where: { status: 'publish_failed' } }),
      db.product.count({ where: { status: 'published' } }),
      db.product.findMany({
        where: { lastError: { not: null } },
        select: { lastError: true, retryCount: true, titleOriginal: true },
        take: 5,
        orderBy: { updatedAt: 'desc' },
      }),
      db.channel.findMany({
        include: { _count: { select: { products: { where: { status: 'pending' } } } } },
      }),
      db.product.findMany({
        where: { status: 'published', publishedAt: { gte: weekAgo } },
        take: 5,
        select: { titleHe: true, titleOriginal: true, commissionRate: true, priceDiscounted: true },
      }),
      (async () => {
        try {
          return await db.order.findMany({
            where: { orderCreatedAt: { gte: weekAgo } },
            select: { commissionFee: true, orderStatus: true },
          });
        } catch { return []; }
      })(),
    ]);

    const realCommission7d = (orders7d as { commissionFee: number }[]).reduce((s, o) => s + o.commissionFee, 0);
    const estimatedCommission7d = (topProducts as { priceDiscounted: number; commissionRate: number }[])
      .reduce((s, p) => s + (p.priceDiscounted * (p.commissionRate / 100)), 0);

    const statsText = `
📊 סיכום יומי — AliExpress Telegram Bot
תאריך: ${new Date().toLocaleDateString('he-IL')}

✅ פורסמו היום: ${publishedToday}
⏳ בהמתנה: ${pendingCount}
❌ נכשלו בפרסום: ${failedCount}
📦 סה"כ פורסמו: ${totalPublished}

ערוצים:
${(channels as { name: string; isActive: boolean; autoPublish: boolean; _count: { products: number } }[])
  .map(c => `  - ${c.name}: ${c.isActive ? 'פעיל' : 'מושהה'}, ${c._count.products} ממתינים, autoPublish: ${c.autoPublish}`)
  .join('\n')}

עמלה אמיתית (7 ימים): $${realCommission7d.toFixed(2)} מ-${(orders7d as unknown[]).length} הזמנות
עמלה משוערת (7 ימים): $${estimatedCommission7d.toFixed(2)}

שגיאות אחרונות:
${(recentErrors as { titleOriginal: string; lastError: string; retryCount: number }[]).length
  ? (recentErrors as { titleOriginal: string; lastError: string; retryCount: number }[])
      .map(e => `  - ${e.titleOriginal}: ${e.lastError} (ניסיון ${e.retryCount})`).join('\n')
  : 'אין שגיאות'}
    `.trim();

    let aiAnalysis = 'לא ניתן לייצר המלצות AI כרגע.';
    try {
      const geminiKey = process.env.GEMINI_API_KEY ||
        (await prisma.setting.findUnique({ where: { key: 'gemini_api_key' } }))?.value;
      if (geminiKey) {
        const genAI = new GoogleGenerativeAI(geminiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });
        const result = await model.generateContent(
          `אתה מנתח ביצועים של בוט אפיליאציה בטלגרם. קיבלת את הנתונים הבאים:\n\n${statsText}\n\nתן סיכום קצר ו-3 המלצות לשיפור. כתוב בעברית, בצורה תמציתית.`
        );
        aiAnalysis = result.response.text();
      }
    } catch (aiErr) {
      console.warn('AI analysis failed:', (aiErr as Error).message);
    }

    const html = `<!DOCTYPE html><html dir="rtl" lang="he">
<head><meta charset="UTF-8"><style>
body{font-family:Arial,sans-serif;direction:rtl;background:#f5f5f5;padding:20px}
.card{background:white;border-radius:8px;padding:20px;margin:10px 0;box-shadow:0 1px 3px rgba(0,0,0,.1)}
h1{color:#1a1a2e}h2{color:#16213e;border-bottom:1px solid #eee;padding-bottom:8px}
.stat{display:inline-block;background:#f0f4ff;border-radius:6px;padding:8px 16px;margin:4px}
.stat-num{font-size:24px;font-weight:bold;color:#3b82f6}
pre{background:#f8f8f8;padding:12px;border-radius:4px;white-space:pre-wrap}
</style></head><body>
<div class="card">
  <h1>📊 סיכום יומי — AliExpress Bot</h1>
  <p>${new Date().toLocaleDateString('he-IL')}</p>
  <div>
    <div class="stat"><div class="stat-num">${publishedToday}</div>פורסמו היום</div>
    <div class="stat"><div class="stat-num">${pendingCount}</div>ממתינים</div>
    <div class="stat"><div class="stat-num">${failedCount}</div>נכשלו</div>
    <div class="stat"><div class="stat-num">$${realCommission7d.toFixed(2)}</div>עמלה 7 ימים</div>
  </div>
</div>
<div class="card"><h2>🤖 ניתוח AI</h2><pre>${aiAnalysis}</pre></div>
${(recentErrors as unknown[]).length ? `<div class="card"><h2>❌ שגיאות אחרונות</h2><ul>
${(recentErrors as { titleOriginal: string; lastError: string }[]).map(e => `<li>${e.titleOriginal}: ${e.lastError}</li>`).join('')}
</ul></div>` : ''}
<div class="card"><h2>📢 ערוצים</h2><ul>
${(channels as { name: string; isActive: boolean; _count: { products: number } }[]).map(c => `<li>${c.name} — ${c.isActive ? '✅ פעיל' : '⏸ מושהה'} — ${c._count.products} ממתינים</li>`).join('')}
</ul></div>
</body></html>`;

    const reviewEmail = process.env.REVIEW_EMAIL_TO ||
      (await prisma.setting.findUnique({ where: { key: 'review_email_to' } }))?.value;

    let emailSent = false;
    let emailError: string | undefined;
    if (reviewEmail) {
      const emailResult = await sendEmail({
        to: reviewEmail,
        subject: `📊 סיכום יומי AliBot — ${new Date().toLocaleDateString('he-IL')}`,
        html,
      });
      emailSent = emailResult.success;
      emailError = emailResult.error;
    }

    return NextResponse.json({
      success: true,
      stats: { publishedToday, pendingCount, failedCount, totalPublished, realCommission7d },
      emailSent,
      emailError,
    });
  } catch (error) {
    console.error('Review cron error:', error);
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'Review failed' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) { return handleReview(req); }
export async function POST(req: NextRequest) { return handleReview(req); }
