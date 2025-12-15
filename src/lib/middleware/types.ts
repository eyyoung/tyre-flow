import { PrismaClient } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

/**
 * 中间件上下文，可以在中间件之间传递数据
 */
export interface MiddlewareContext {
  user?: {
    userId: string;
    username: string;
    role: string;
    collectionPointIds: string[];
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: PrismaClient | any; // Prisma extended client
  // 未来可扩展更多上下文
  [key: string]: unknown;
}

/**
 * 中间件函数签名
 * @param ctx 上下文对象，可在中间件之间共享数据
 * @param request Next.js 请求对象
 * @param next 调用下一个中间件
 */
export type Middleware = (
  ctx: MiddlewareContext,
  request: NextRequest,
  next: () => Promise<NextResponse>
) => Promise<NextResponse>;

/**
 * 最终处理器签名
 */
export type FinalHandler = (
  ctx: MiddlewareContext,
  request: NextRequest
) => Promise<NextResponse>;

