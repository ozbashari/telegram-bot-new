// src/app/api/auth/login/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { signJWT } from '@/lib/jwt';

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();
    const adminPassword = process.env.ADMIN_PASSWORD;
    const jwtSecret = process.env.JWT_SECRET || 'default-fallback-secret-for-development-do-not-use-in-production';

    if (!adminPassword) {
      return NextResponse.json(
        { success: false, error: 'ססמת מנהל אינה מוגדרת בשרת. אנא הגדר את ADMIN_PASSWORD.' },
        { status: 500 }
      );
    }

    if (password !== adminPassword) {
      return NextResponse.json(
        { success: false, error: 'סיסמה שגויה, אנא נסה שוב.' },
        { status: 401 }
      );
    }

    // 7 days token validity
    const expiresInMs = 7 * 24 * 60 * 60 * 1000;
    const payload = {
      role: 'admin',
      exp: Date.now() + expiresInMs,
    };

    const token = await signJWT(payload, jwtSecret);

    const response = NextResponse.json({ success: true, message: 'התחברת בהצלחה ✅' });
    
    response.cookies.set({
      name: 'token',
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
    });

    return response;
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'שגיאת שרת פנימית' },
      { status: 500 }
    );
  }
}
