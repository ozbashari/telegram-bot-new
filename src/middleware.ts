// src/middleware.ts
import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT } from './lib/jwt';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1. Bypass static resources
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/fonts') ||
    pathname.startsWith('/favicon.ico') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // 2. Bypass login page and auth API endpoints
  if (
    pathname === '/login' ||
    pathname === '/api/auth/login' ||
    pathname === '/api/auth/logout'
  ) {
    return NextResponse.next();
  }

  // 3. Bypass CRON endpoints (they carry their own authorization security)
  if (pathname.startsWith('/api/cron/')) {
    return NextResponse.next();
  }

  // 4. Retrieve cookie token
  const token = req.cookies.get('token')?.value;
  const jwtSecret = process.env.JWT_SECRET || 'default-fallback-secret-for-development-do-not-use-in-production';

  let isAuthenticated = false;
  if (token) {
    const payload = await verifyJWT(token, jwtSecret);
    if (payload && payload.role === 'admin') {
      isAuthenticated = true;
    }
  }

  // 5. Allow access if authenticated
  if (isAuthenticated) {
    return NextResponse.next();
  }

  // 6. Handle unauthorized access
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized: Access token missing or invalid.' },
      { status: 401 }
    );
  }

  // Redirect to login page for pages
  const loginUrl = new URL('/login', req.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
