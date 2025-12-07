import { compare, hash } from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-secret-key-here-min-32-chars-long-xxxxx'
);

const COOKIE_NAME = 'auth-token';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export interface JWTPayload {
  userId: string;
  username: string;
  role: string;
  exp?: number;
}

// 密码加密
export async function hashPassword(password: string): Promise<string> {
  return hash(password, 12);
}

// 密码验证
export async function verifyPassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  return compare(password, hashedPassword);
}

// 生成 JWT Token
export async function generateToken(payload: Omit<JWTPayload, 'exp'>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(JWT_SECRET);
}

// 验证 JWT Token
export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

// 设置认证 Cookie
export async function setAuthCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  // 只有在 HTTPS 环境下才启用 secure（通过 SECURE_COOKIES 环境变量控制）
  const isSecure = process.env.SECURE_COOKIES === 'true';
  
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: isSecure ? 'strict' : 'lax',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });
}

// 获取认证 Cookie
export async function getAuthCookie(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAME)?.value;
}

// 清除认证 Cookie
export async function clearAuthCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

// 获取当前用户
export async function getCurrentUser(): Promise<JWTPayload | null> {
  const token = await getAuthCookie();
  if (!token) return null;
  return verifyToken(token);
}

// 认证中间件辅助函数
export function createAuthResponse(message: string, status: number) {
  return NextResponse.json({ message }, { status });
}

// 受保护的 API 路由装饰器
export async function withAuth(
  request: NextRequest,
  handler: (user: JWTPayload, request: NextRequest) => Promise<NextResponse>
): Promise<NextResponse> {
  const token = request.cookies.get(COOKIE_NAME)?.value;

  if (!token) {
    return createAuthResponse('Unauthorized', 401);
  }

  const user = await verifyToken(token);
  if (!user) {
    return createAuthResponse('Invalid or expired token', 401);
  }

  return handler(user, request);
}

// 检查是否是管理员
export function isAdmin(user: JWTPayload): boolean {
  return user.role === 'ADMIN';
}

