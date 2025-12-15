import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { Middleware, MiddlewareContext } from './types';

const COOKIE_NAME = 'auth-token';

/**
 * 认证中间件 - 验证 JWT Token
 */
export const authMiddleware: Middleware = async (ctx, request, next) => {
  const token = request.cookies.get(COOKIE_NAME)?.value;

  if (!token) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const user = await verifyToken(token);
  if (!user) {
    return NextResponse.json({ message: 'Invalid or expired token' }, { status: 401 });
  }

  // 将用户信息注入上下文
  ctx.user = user as MiddlewareContext['user'];

  // 继续下一个中间件
  return next();
};

/**
 * 管理员权限中间件 - 要求用户是管理员
 * 注意：必须在 authMiddleware 之后使用
 */
export const adminOnlyMiddleware: Middleware = async (ctx, request, next) => {
  if (!ctx.user) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  if (ctx.user.role !== 'ADMIN') {
    return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  }

  return next();
};

