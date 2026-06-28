# PRD - מערכת אוטומציה לפרסום מוצרי AliExpress בטלגרם
**גרסה:** 1.1  
**סטטוס:** מוכן לפיתוח  
**מחסנית טכנית:** Next.js 14+ / TypeScript / Supabase (PostgreSQL) / Gemini API / Telegram Bot API / AliExpress Official Affiliate API

> **שינוי מגרסה 1.0:** מסד הנתונים שונה מ-SQLite ל-Supabase (PostgreSQL) - SQLite אינו נתמך על Vercel בסביבת production. כל שאר הארכיטקטורה נשמרה.

---

## 1. מטרת המוצר

מערכת אוטומציה שסורקת מוצרים מאליאקספרס לפי קטגוריות שהמשתמש הגדיר, ממירה אותם לקישורי שותפים, מייצרת עבורם תוכן שיווקי בעברית באמצעות AI, ומפרסמת אותם לערוץ טלגרם - ידנית עם אישור, או אוטומטית לפי תזמון.

**MVP:** תמיכה בערוץ טלגרם אחד. הארכיטקטורה מוכנה להרחבה ל-10+ ערוצים ללא שינוי בקוד.

---

## 2. ארכיטקטורת המערכת

```
┌─────────────────────────────────────────────────────────┐
│                     Next.js App Router                  │
│  /app                                                   │
│  ├── (dashboard)/          → לוח בקרה ראשי              │
│  ├── queue/                → תור אישורים                │
│  ├── manual/               → הזנה ידנית                 │
│  ├── settings/             → הגדרות ומפתחות             │
│  └── api/                                               │
│      ├── cron/run           → טריגר סריקה (מאובטח)      │
│      ├── products/scan      → Discovery Engine          │
│      ├── products/generate  → AI Content Generator      │
│      ├── products/approve   → אישור ופרסום              │
│      ├── products/reject    → דחיית מוצר                │
│      ├── products/edit      → עריכת תוכן לפני פרסום    │
│      ├── telegram/publish   → Publishing Engine         │
│      ├── telegram/test      → שליחת הודעת בדיקה        │
│      ├── dashboard/stats    → נתוני לוח בקרה            │
│      └── settings/          → GET + POST הגדרות         │
└─────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
  AliExpress API        Gemini API          Telegram Bot API
  (Discovery +          (Content            (sendPhoto +
   LinkGenerate)         Generation)         InlineKeyboard)
         │
         ▼
    Supabase (PostgreSQL)
    (נתונים + היסטוריה)
```

---

## 3. סביבת אחסון ופריסה

| רכיב | שירות | עלות |
|---|---|---|
| קוד + ממשק | Vercel | חינם |
| מסד נתונים | Supabase (PostgreSQL) | חינם עד 500MB |
| Cron Jobs | Vercel Cron | חינם (פעם ביום) / Pro לתדירות גבוהה |
| AI | Gemini 1.5 Flash | חינם עד מכסה נדיבה |

**הערה חשובה לגבי Cron:** התוכנית החינמית של Vercel מאפשרת cron פעם ביום בלבד. אם תרצה לסרוק כל 6 שעות - תצטרך Vercel Pro ($20/חודש) **או** להשתמש ב-GitHub Actions כתחליף חינמי (מפורט בסעיף 4.5).

---

## 4. מודולי הליבה

### מודול 1: Discovery Engine
**קובץ:** `src/lib/discovery.ts`

**תהליך מלא:**
1. קרא מה-DB את רשימת הערוצים הפעילים + הקטגוריות שלהם
2. לכל ערוץ, לכל קטגוריה - קרא ל-`aliexpress.affiliate.product.query`:

```typescript
// פרמטרים לקריאה
{
  category_ids: string,        // מה-channel settings
  sort: "SALE_PRICE_ASC",      // הנחה גדולה קודם
  fields: [
    "product_id",
    "product_title", 
    "sale_price",
    "original_price",
    "discount",
    "product_main_image_url",
    "commission_rate",
    "evaluate_rate",
    "product_detail_url",
    "lastest_volume"
  ].join(","),
  page_size: 20,
  page_no: 1,
  target_currency: "USD",
  target_language: "EN"
}
```

3. **סינון ראשוני** (בצד השרת, לפני DB):
   - `commission_rate >= settings.min_commission_rate`
   - `evaluate_rate >= settings.min_rating`
   - `lastest_volume >= settings.min_sales`
   - `discount > 0` (חייב להיות הנחה כלשהי)

4. **Deduplication** - לכל מוצר שעבר סינון:
```sql
SELECT id FROM products 
WHERE aliexpress_product_id = $1 
AND created_at > NOW() - INTERVAL '$2 days'
```
אם קיים - דלג. אם לא - המשך.

5. מוצרים חדשים → יצירת קישור שותפים (מודול 2) → שמירה ב-DB עם `status = 'pending'` → AI Content Generation (מודול 3)

**API Endpoint:** `POST /api/products/scan`
```typescript
// Headers
{ Authorization: "Bearer CRON_SECRET" }

// Response
{
  success: boolean,
  scanned: number,       // כמה מוצרים נסרקו מאליאקספרס
  new: number,           // כמה עברו dedup ונשמרו
  duplicates: number,    // כמה דולגו
  errors: string[]       // שגיאות אם היו
}
```

---

### מודול 2: Monetization Engine
**קובץ:** `src/lib/monetization.ts`

**תהליך:**
1. קבל `product_detail_url` מ-Discovery
2. קרא ל-`aliexpress.affiliate.link.generate`:
```typescript
{
  promotion_link_type: "0",           // 0 = רגיל, 2 = App Deep Link
  source_values: product_detail_url,
  tracking_id: settings.aliexpress_tracking_id
}
```
3. שמור `affiliate_link` ב-DB על המוצר
4. **Fallback:** אם הקריאה נכשלה - שמור את ה-URL המקורי עם הוספת tracking param ידני

**הערה:** מודול זה רץ כחלק מה-Discovery, לא endpoint נפרד.

---

### מודול 3: AI Content Generator
**קובץ:** `src/lib/ai-generator.ts`

**מודל:** `gemini-1.5-flash` (מהיר + זול + מספיק חזק לתוכן שיווקי)

**System Prompt (ניתן לעריכה מהממשק):**
```
אתה כותב תוכן שיווקי לערוץ טלגרם ישראלי שמוכר מוצרים מאליאקספרס.
כתוב בעברית, בסגנון קליל, מזמין ולא רובוטי - כאילו חבר ממליץ על מוצר.
אל תשתמש בביטויים כמו "מוצר מדהים" או "לא תאמין" - זה נשמע ספאם.
החזר JSON בלבד, ללא טקסט נוסף, ללא ```json, בפורמט הבא:
{
  "title": "כותרת עם אימוג'י אחד, עד 60 תווים",
  "body": "2-3 משפטים שמסבירים למה שווה לקנות",
  "bullets": ["יתרון 1", "יתרון 2", "יתרון 3"],
  "cta": "משפט סיום קצר עם דחיפות קלה"
}
```

**User Prompt (נבנה דינמית):**
```
מוצר: {title_original}
מחיר מקורי: ${price_original}
מחיר מבצע: ${price_discounted}
הנחה: {discount_percent}%
דירוג: {rating}/5 ({sales_count} מכירות)
```

**טיפול בשגיאות AI:**
- אם ה-JSON לא תקין - ניסיון נוסף אחד אוטומטי
- אחרי 2 כישלונות - שמור מוצר עם `status = 'ai_failed'` ותצוגה מיוחדת בממשק

**API Endpoint:** `POST /api/products/generate`
```typescript
// Body
{ productId: string }
// Response
{ 
  title_he: string, 
  description_he: string,
  status: "success" | "failed"
}
```

---

### מודול 4: Publishing Engine
**קובץ:** `src/lib/telegram.ts`

**בניית ההודעה הסופית:**
```typescript
function buildCaption(product: Product): string {
  // חשוב: MarkdownV2 דורש escape של תווים מיוחדים: . ! ( ) - = > # +
  const title = escapeMarkdownV2(product.title_he);
  const body = escapeMarkdownV2(product.body_he);
  const bullets = product.bullets_he.map(b => `✅ ${escapeMarkdownV2(b)}`).join('\n');
  const priceNew = escapeMarkdownV2(`$${product.price_discounted}`);
  const priceOld = escapeMarkdownV2(`$${product.price_original}`);
  
  return `*${title}*\n\n${body}\n\n${bullets}\n\n💰 *מחיר: ${priceNew}* ~${priceOld}~\n🔥 חיסכון של ${product.discount_percent}%`;
}
```

**קריאה ל-Telegram API:**
```typescript
POST https://api.telegram.org/bot{token}/sendPhoto
{
  chat_id: channel.telegram_chat_id,
  photo: product.image_url,
  caption: buildCaption(product),
  parse_mode: "MarkdownV2",
  reply_markup: {
    inline_keyboard: [[
      { 
        text: "🛒 לרכישה לחץ כאן", 
        url: product.affiliate_link 
      }
    ]]
  }
}
```

**טיפול בתמונה שנכשלת:**
- אם `sendPhoto` נכשל (תמונה לא נגישה) - fallback ל-`sendMessage` עם טקסט בלבד + קישור תמונה

**API Endpoint:** `POST /api/telegram/publish`
```typescript
// Body
{ productId: string, channelId: string }
// Response
{ 
  success: boolean, 
  telegram_message_id: string,
  error?: string
}
```

**API Endpoint בדיקה:** `POST /api/telegram/test`
```typescript
// שולח הודעת "הבוט פעיל ✅" לערוץ לוידוא חיבור
{ channelId: string }
```

---

### מודול 5: Automation & Cron
**קובץ:** `src/lib/scheduler.ts`

**תהליך מלא אוטומטי (`auto_publish = true`):**
```
cron trigger (כל X שעות)
  → בדוק: האם עבר מספיק זמן מאז הפרסום האחרון של הערוץ?
  → scan() + monetize() + generateContent()
  → publish() לטלגרם
  → עדכן last_published_at
  → רשום ב-publish_log
```

**תהליך חצי-אוטומטי (`auto_publish = false`):**
```
cron trigger
  → scan() + monetize() + generateContent()
  → status = 'pending'
  → ממתין לאישור בממשק
```

**הגדרת Cron ב-`vercel.json`:**
```json
{
  "crons": [
    {
      "path": "/api/cron/run",
      "schedule": "0 */6 * * *"
    }
  ]
}
```

**אלטרנטיבה חינמית ל-Vercel Pro - GitHub Actions:**
```yaml
# .github/workflows/cron.yml
name: Bot Cron
on:
  schedule:
    - cron: '0 */6 * * *'  # כל 6 שעות
jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger scan
        run: |
          curl -X POST https://your-app.vercel.app/api/cron/run \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
```

**אבטחת endpoint הCron:**
```typescript
// בתוך /api/cron/run/route.ts
const secret = request.headers.get('authorization')?.replace('Bearer ', '');
if (secret !== process.env.CRON_SECRET) {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}
```

---

## 5. מסד הנתונים - Supabase (PostgreSQL)

**כלי ORM:** Prisma

### סכמת הטבלאות המלאה

```prisma
// prisma/schema.prisma

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Product {
  id                  String      @id @default(uuid())
  aliexpressProductId String      @unique
  titleOriginal       String
  titleHe             String?
  bodyHe              String?
  bulletsHe           String?     // JSON array as string
  ctaHe               String?
  priceOriginal       Float
  priceDiscounted     Float
  discountPercent     Int
  imageUrl            String
  affiliateLink       String?
  categoryId          String
  commissionRate      Float
  rating              Float
  salesCount          Int
  status              String      @default("pending")
  // status options: pending | approved | published | rejected | ai_failed
  channelId           String
  publishedAt         DateTime?
  createdAt           DateTime    @default(now())
  updatedAt           DateTime    @updatedAt
  
  channel             Channel     @relation(fields: [channelId], references: [id])
  publishLog          PublishLog[]

  @@index([status])
  @@index([channelId])
  @@index([aliexpressProductId])
  @@index([createdAt])
}

model Channel {
  id                   String      @id @default(uuid())
  name                 String
  telegramChatId       String
  botToken             String
  categories           String      // JSON array of AliExpress category IDs
  isActive             Boolean     @default(true)
  autoPublish          Boolean     @default(false)
  publishIntervalHours Int         @default(6)
  lastPublishedAt      DateTime?
  createdAt            DateTime    @default(now())
  updatedAt            DateTime    @updatedAt
  
  products             Product[]
  publishLog           PublishLog[]
}

model Setting {
  key       String   @id
  value     String
  updatedAt DateTime @updatedAt
}

// Settings keys:
// aliexpress_app_key, aliexpress_app_secret, aliexpress_tracking_id
// gemini_api_key
// ai_system_prompt, ai_post_template
// min_commission_rate (default: "5")
// min_rating (default: "4.5")
// min_sales (default: "100")
// dedup_days (default: "30")
// bot_active (default: "true")

model PublishLog {
  id              String    @id @default(uuid())
  productId       String
  channelId       String
  telegramMsgId   String?
  publishedAt     DateTime  @default(now())
  status          String    // success | failed
  errorMessage    String?
  
  product         Product   @relation(fields: [productId], references: [id])
  channel         Channel   @relation(fields: [channelId], references: [id])

  @@index([channelId])
  @@index([publishedAt])
}
```

**הערה על `bulletsHe`:** נשמר כ-JSON string (`'["יתרון 1","יתרון 2","יתרון 3"]'`) ומפורס בצד הקוד. SQLite לא תומך ב-array native, ו-PostgreSQL תומך אבל Prisma מייצג אותו כ-string לגמישות מקסימלית.

---

## 6. ה-API של AliExpress - פירוט טכני

**Base URL:** `https://api-sg.aliexpress.com/sync`  
**Auth:** HMAC-SHA256 על כל request

### Endpoints בשימוש:

| Endpoint | שימוש |
|---|---|
| `aliexpress.affiliate.product.query` | חיפוש מוצרים לפי קטגוריה |
| `aliexpress.affiliate.link.generate` | יצירת קישור שותפים |
| `aliexpress.affiliate.category.get` | שליפת רשימת קטגוריות (להגדרות) |

### פונקציית חתימה מלאה:
```typescript
// src/lib/aliexpress-client.ts

import crypto from 'crypto';

interface AliParams {
  [key: string]: string;
}

function buildSignature(method: string, params: AliParams, secret: string): string {
  // מיין פרמטרים לפי שם
  const sorted = Object.keys(params).sort();
  // חבר: method + key1value1key2value2...
  const toSign = method + sorted.map(k => `${k}${params[k]}`).join('');
  return crypto
    .createHmac('sha256', secret)
    .update(toSign)
    .digest('hex')
    .toUpperCase();
}

export async function callAliExpress(method: string, params: AliParams) {
  const appKey = process.env.ALIEXPRESS_APP_KEY!;
  const appSecret = process.env.ALIEXPRESS_APP_SECRET!;
  
  const baseParams: AliParams = {
    method,
    app_key: appKey,
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
    sign_method: 'hmac-sha256',
    format: 'json',
    v: '2.0',
    ...params
  };
  
  baseParams.sign = buildSignature(method, baseParams, appSecret);
  
  const url = new URL('https://api-sg.aliexpress.com/sync');
  Object.entries(baseParams).forEach(([k, v]) => url.searchParams.set(k, v));
  
  const response = await fetch(url.toString());
  return response.json();
}
```

---

## 7. ממשק המשתמש - מסכים מלאים

### 7.1 Dashboard (`/`)

**קומפוננטות:**
- `StatsBar` - 4 כרטיסים:
  - פורסמו היום
  - ממתינים לאישור (עם badge אדום אם > 0)
  - סה"כ פורסמו
  - עמלה משוערת (חישוב: ממוצע עמלה × מספר פרסומים)
- `BotStatus` - מחוון ירוק/אדום + כפתור הפעלה/עצירה + "סרוק עכשיו" ידני
- `RecentPublished` - 5 פרסומים אחרונים: תמונה ממוזערת + שם + ערוץ + זמן
- `ChannelsSummary` - כרטיס לכל ערוץ: סטטוס + פרסום אחרון + כמה בתור

---

### 7.2 תור אישורים (`/queue`)

**קומפוננטות:**
- `QueueFilters` - סינון: ערוץ / קטגוריה / סטטוס (pending / ai_failed)
- `ProductCard` × N - לכל מוצר בתור:
  - תמונת מוצר
  - כותרת מקורית (EN) + כותרת בעברית
  - **Preview מלא של הפוסט כפי שיופיע בטלגרם** (כולל עיצוב)
  - **שדה textarea לעריכה ישירה** לפני פרסום (PATCH → `/api/products/edit`)
  - מחיר + הנחה + עמלה + דירוג
  - כפתורים: `✅ אשר ופרסם` / `🔄 צור מחדש עם AI` / `🗑️ מחק`

---

### 7.3 הזנה ידנית (`/manual`)

**תהליך:**
```
הדבק URL של מוצר מ-AliExpress
  → parse product_id מה-URL
  → בחר ערוץ יעד
  → לחץ "עבד מוצר"
  → [Discovery → Monetize → AI Generate]
  → Preview מלא
  → "פרסם עכשיו" או "שמור לתור"
```

---

### 7.4 הגדרות (`/settings`)

**4 לשוניות:**

**חיבורים:**
- שדות API Keys (מוסתרים, type=password)
- כפתור "בדוק חיבור" לכל שירות
- אינדיקטור ✅/❌ לכל חיבור

**ערוצים:**
- רשימת ערוצים + כפתור "הוסף ערוץ"
- Modal להוספה: שם / Chat ID / Bot Token / קטגוריות / אוטומטי / תזמון
- כפתור "שלח הודעת בדיקה" לכל ערוץ

**כללי סריקה:**
- עמלה מינימלית - slider 1-20%
- דירוג מינימלי - slider 1-5 (0.5 פעמים)
- מכירות מינימליות - number input
- ימי dedup - number input (ברירת מחדל: 30)

**תבנית AI:**
- textarea לעריכת System Prompt
- textarea לתבנית הפוסט הסופי
- כפתור "שמור" + "איפוס לברירת מחדל"
- כפתור "בדוק תבנית" - מריץ AI על מוצר לדוגמה ומציג preview

---

## 8. מבנה תיקיות הפרויקט

```
/
├── app/
│   ├── page.tsx                          (dashboard)
│   ├── queue/
│   │   └── page.tsx
│   ├── manual/
│   │   └── page.tsx
│   ├── settings/
│   │   └── page.tsx
│   └── api/
│       ├── cron/
│       │   └── run/route.ts
│       ├── products/
│       │   ├── route.ts                  (GET list with filters)
│       │   ├── scan/route.ts
│       │   ├── generate/route.ts
│       │   ├── approve/route.ts
│       │   ├── reject/route.ts
│       │   └── edit/route.ts             (PATCH - עריכת תוכן)
│       ├── telegram/
│       │   ├── publish/route.ts
│       │   └── test/route.ts
│       ├── dashboard/
│       │   └── stats/route.ts
│       └── settings/
│           └── route.ts
├── src/
│   ├── lib/
│   │   ├── db.ts                         (Prisma singleton)
│   │   ├── aliexpress-client.ts          (API + Signature)
│   │   ├── discovery.ts                  (scan + dedup)
│   │   ├── monetization.ts               (link generation)
│   │   ├── ai-generator.ts               (Gemini)
│   │   ├── telegram.ts                   (bot publisher)
│   │   ├── scheduler.ts                  (cron orchestration)
│   │   └── markdown-escape.ts            (MarkdownV2 escaping)
│   ├── components/
│   │   ├── dashboard/
│   │   │   ├── StatsBar.tsx
│   │   │   ├── BotStatus.tsx
│   │   │   ├── RecentPublished.tsx
│   │   │   └── ChannelsSummary.tsx
│   │   ├── queue/
│   │   │   ├── ProductCard.tsx
│   │   │   ├── TelegramPreview.tsx       (preview מדויק של הפוסט)
│   │   │   └── QueueFilters.tsx
│   │   ├── settings/
│   │   │   ├── ApiKeysTab.tsx
│   │   │   ├── ChannelsTab.tsx
│   │   │   ├── ScanRulesTab.tsx
│   │   │   └── AiTemplateTab.tsx
│   │   └── shared/
│   │       ├── Modal.tsx
│   │       └── StatusBadge.tsx
│   └── types/
│       └── index.ts                      (Product, Channel, Setting types)
├── prisma/
│   └── schema.prisma
├── .env.local
├── .gitignore                            (חובה: .env.local)
├── vercel.json
└── .github/
    └── workflows/
        └── cron.yml                      (אלטרנטיבה חינמית לcron)
```

---

## 9. קבצי תצורה

### `.env.local`
```env
# AliExpress
ALIEXPRESS_APP_KEY=
ALIEXPRESS_APP_SECRET=
ALIEXPRESS_TRACKING_ID=

# AI
GEMINI_API_KEY=

# Database (מ-Supabase dashboard)
DATABASE_URL="postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres"

# Security
CRON_SECRET=החלף_עם_מחרוזת_אקראית_ארוכה

# App
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app
```

### `.gitignore` (חשוב לאבטחה)
```
.env.local
.env
node_modules/
.next/
```

### `vercel.json`
```json
{
  "crons": [
    {
      "path": "/api/cron/run",
      "schedule": "0 */6 * * *"
    }
  ]
}
```

---

## 10. סקיילביליות - מה מוכן ל-V2

| פיצ'ר | V1 (MVP) | V2 |
|---|---|---|
| ערוצי טלגרם | 1 | עד 20, כל אחד עצמאי |
| מסד נתונים | Supabase חינם | Supabase Pro (מעבר של שורה אחת) |
| AI | Gemini Flash | בחירת מודל מהממשק |
| Redirect Tracking | ❌ | `/r/{slug}` עם לוג כניסות לכל לחיצה |
| A/B Testing | ❌ | 2 גרסאות פוסט לכל מוצר, מדידת CTR |
| Analytics | בסיסי | CTR לפי ערוץ / קטגוריה / שעה |
| Multi-user | ❌ | NextAuth + Roles |
| תמיכה בפלטפורמות נוספות | טלגרם בלבד | WhatsApp / Instagram |

---

## 11. סדר פיתוח מומלץ

```
שלב 1: תשתית (יום 1)
  ✓ Next.js 14 + TypeScript
  ✓ Prisma + Supabase setup
  ✓ מיגרציה ראשונה (כל הטבלאות)
  ✓ .env.local + .gitignore

שלב 2: Settings UI (יום 1-2)
  ✓ Layout + Navigation
  ✓ מסך הגדרות (מפתחות + ערוצים)
  ✓ שמירת הגדרות ל-DB

שלב 3: AliExpress Integration (יום 2-3)
  ✓ aliexpress-client.ts עם חתימה
  ✓ endpoint scan
  ✓ Deduplication logic
  ✓ endpoint קטגוריות (לsettings)

שלב 4: Monetization (יום 3)
  ✓ link generation בתוך discovery
  ✓ fallback אם נכשל

שלב 5: AI Generation (יום 3-4)
  ✓ Gemini client
  ✓ Prompt template
  ✓ JSON parsing + error handling
  ✓ endpoint generate

שלב 6: Telegram Publisher (יום 4)
  ✓ buildCaption + MarkdownV2 escaping
  ✓ sendPhoto + InlineKeyboard
  ✓ fallback לtextOnly
  ✓ endpoint publish + test

שלב 7: Queue UI (יום 4-5)
  ✓ ProductCard עם TelegramPreview
  ✓ עריכת תוכן ישירה
  ✓ אישור / דחייה / צור מחדש

שלב 8: Automation (יום 5)
  ✓ scheduler.ts - orchestration מלא
  ✓ vercel.json cron
  ✓ GitHub Actions fallback

שלב 9: Dashboard (יום 5-6)
  ✓ Stats
  ✓ Bot status + הפעלה/עצירה
  ✓ Recent publishes

שלב 10: בדיקות ו-QA (יום 6-7)
  ✓ בדיקת זרימה מלאה end-to-end
  ✓ וידוא MarkdownV2 escaping תקין
  ✓ בדיקת fallbacks
```

---

## 12. נקודות תשומת לב קריטיות לפיתוח

**MarkdownV2 escaping:**
תווים שחייבים escape בטלגרם: `. ! ( ) - = > # + { } | ~`
חייב לבנות פונקציית `escapeMarkdownV2()` ולהפעיל על כל טקסט דינמי.

**Rate Limits:**
- AliExpress API: ~1000 קריאות ביום בחשבון חדש
- Gemini Flash: 15 requests/minute בחינם
- Telegram: 30 הודעות/שניה לבוט (לא רלוונטי לנו)

**Supabase Connection Pooling:**
ב-Vercel serverless - חייב להשתמש ב-connection pooling של Supabase (PgBouncer):
```env
DATABASE_URL="postgresql://postgres.[ref]:[password]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.[ref]:[password]@db.[ref].supabase.co:5432/postgres"
```
ב-schema.prisma להוסיף: `directUrl = env("DIRECT_URL")`

---

*PRD Version 1.1 | מוכן לפיתוח עם Cursor / Claude Code / Windsurf / Antigravity*
