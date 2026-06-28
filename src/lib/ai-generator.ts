// src/lib/ai-generator.ts
import { GoogleGenerativeAI } from '@google/generative-ai';
import { prisma } from './db';

const DEFAULT_SYSTEM_PROMPT = `אתה כותב תוכן שיווקי לערוץ טלגרם ישראלי שמוכר מוצרים מאליאקספרס.
כתוב בעברית, בסגנון קליל, מזמין ולא רובוטי - כאילו חבר ממליץ על מוצר.
אל תשתמש בביטויים כמו "מוצר מדהים" או "לא תאמין" - זה נשמע ספאם.
החזר JSON בלבד, ללא טקסט נוסף, ללא \`\`\`json, בפורמט הבא:
{
  "title": "כותרת עם אימוג'י אחד, עד 60 תווים",
  "body": "2-3 משפטים שמסבירים למה שווה לקנות",
  "bullets": ["יתרון 1", "יתרון 2", "יתרון 3"],
  "cta": "משפט סיום קצר עם דחיפות קלה"
}`;

const DEFAULT_USER_PROMPT_TEMPLATE = `מוצר: {title_original}
מחיר מקורי: \${price_original}
מחיר מבצע: \${price_discounted}
הנחה: {discount_percent}%
דירוג: {rating}/5 ({sales_count} מכירות)`;

export interface GenerationResult {
  title_he: string;
  description_he: string;
  status: 'success' | 'failed';
  error?: string;
}

export async function generateContent(productId: string): Promise<GenerationResult> {
  // 1. Fetch settings from DB
  const dbSettings = await prisma.setting.findMany();
  const settingsMap = new Map(dbSettings.map(s => [s.key, s.value]));

  const apiKey = settingsMap.get('gemini_api_key') || process.env.GEMINI_API_KEY;
  const systemPrompt = settingsMap.get('ai_system_prompt') || DEFAULT_SYSTEM_PROMPT;
  const userPromptTemplate = settingsMap.get('ai_post_template') || DEFAULT_USER_PROMPT_TEMPLATE;

  if (!apiKey) {
    throw new Error('Gemini API key is not configured in settings or environment variables.');
  }

  // 2. Fetch target product from DB
  const product = await prisma.product.findUnique({
    where: { id: productId },
  });

  if (!product) {
    throw new Error(`Product with ID ${productId} not found in database.`);
  }

  // 3. Build user prompt string
  const userPrompt = userPromptTemplate
    .replace('{title_original}', product.titleOriginal)
    .replace('{price_original}', String(product.priceOriginal))
    .replace('{price_discounted}', String(product.priceDiscounted))
    .replace('{discount_percent}', String(product.discountPercent))
    .replace('{rating}', String(product.rating))
    .replace('{sales_count}', String(product.salesCount));

  // 4. Initialize Gemini API Client
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash-lite',
    systemInstruction: systemPrompt,
    generationConfig: {
      responseMimeType: 'application/json',
    },
  });

  let attempts = 0;
  let success = false;
  let lastError: Error | null = null;
  let parsedData: {
    title: string;
    body: string;
    bullets: string[];
    cta: string;
  } | null = null;

  // Retry logic: Run up to 2 attempts if JSON parsing fails
  while (attempts < 2 && !success) {
    attempts++;
    try {
      const chat = model.startChat();

      const result = await chat.sendMessage(userPrompt);
      const text = result.response.text();

      // Clean string wrappers just in case
      let cleanedText = text.trim();
      if (cleanedText.startsWith('```')) {
        cleanedText = cleanedText
          .replace(/^```json\s*/, '')
          .replace(/```$/, '')
          .trim();
      }

      parsedData = JSON.parse(cleanedText);
      
      // Basic schema validation check
      if (parsedData && parsedData.title && parsedData.body) {
        success = true;
      } else {
        throw new Error("Gemini response is missing required JSON fields: 'title' or 'body'");
      }
    } catch (err) {
      console.warn(`Gemini generation attempt ${attempts} failed: ${(err as Error).message || err}`);
      lastError = err as Error;
    }
  }

  if (success && parsedData) {
    // 5. Update product on success
    const descriptionHe = `${parsedData.body}\n\n${(parsedData.bullets || [])
      .map(b => `✅ ${b}`)
      .join('\n')}\n\n${parsedData.cta || ''}`;

    await prisma.product.update({
      where: { id: productId },
      data: {
        titleHe: parsedData.title,
        bodyHe: parsedData.body,
        bulletsHe: JSON.stringify(parsedData.bullets || []),
        ctaHe: parsedData.cta || '',
        status: product.status === 'ai_failed' ? 'pending' : product.status, // reset status if retried from failure
      },
    });

    return {
      title_he: parsedData.title,
      description_he: descriptionHe,
      status: 'success',
    };
  } else {
    // 6. Flag product as failed after all retry attempts fail
    await prisma.product.update({
      where: { id: productId },
      data: {
        status: 'ai_failed',
      },
    });

    return {
      title_he: '',
      description_he: '',
      status: 'failed',
      error: lastError?.message || 'AI Content Generation failed.',
    };
  }
}
