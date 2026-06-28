// src/app/api/products/generate/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { generateContent } from '@/lib/ai-generator';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { productId } = body;

    if (!productId) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: productId' },
        { status: 400 }
      );
    }

    // Run Gemini AI generation
    const result = await generateContent(productId);

    if (result.status === 'success') {
      return NextResponse.json({
        success: true,
        title_he: result.title_he,
        description_he: result.description_he,
      });
    } else {
      return NextResponse.json(
        { success: false, error: result.error || 'AI Content Generation failed' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('AI generation API endpoint error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: (error as Error).message || 'AI Content Generation execution failed' 
      },
      { status: 500 }
    );
  }
}
