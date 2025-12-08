import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { locales, defaultLocale } from './i18n/config';

const intlMiddleware = createMiddleware({
  locales,
  defaultLocale,
  localePrefix: 'always',
});

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-secret-key-here-min-32-chars-long-xxxxx'
);

const COOKIE_NAME = 'auth-token';

// 验证 token 是否有效
async function isValidToken(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}

// 从路径中提取 locale
function getLocaleFromPath(pathname: string): string {
  const segments = pathname.split('/');
  const potentialLocale = segments[1];
  if (locales.includes(potentialLocale as typeof locales[number])) {
    return potentialLocale;
  }
  return defaultLocale;
}

// 检查是否是登录页面
function isLoginPage(pathname: string): boolean {
  return pathname.endsWith('/login') || pathname.match(/^\/[a-z]{2}\/login$/) !== null;
}

// 检查是否是受保护的页面
function isProtectedPage(pathname: string): boolean {
  // dashboard 和其子页面都是受保护的
  return pathname.includes('/dashboard');
}

export default async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Skip middleware for API routes, static files, etc.
  if (
    pathname.startsWith('/api') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // 获取认证 token
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const isAuthenticated = token ? await isValidToken(token) : false;
  const locale = getLocaleFromPath(pathname);

  // 如果已登录且访问登录页面，重定向到 dashboard
  if (isAuthenticated && isLoginPage(pathname)) {
    return NextResponse.redirect(new URL(`/${locale}/dashboard`, request.url));
  }

  // 如果未登录且访问受保护页面，重定向到登录页面
  if (!isAuthenticated && isProtectedPage(pathname)) {
    return NextResponse.redirect(new URL(`/${locale}/login`, request.url));
  }

  // Apply internationalization middleware
  return intlMiddleware(request);
}

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};

