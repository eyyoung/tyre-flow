import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { Middleware, MiddlewareContext, FinalHandler } from './types';

/**
 * 洋葱模型中间件组合器
 * 灵感来自 Koa compose
 */
export function compose(middlewares: Middleware[]) {
  return function (ctx: MiddlewareContext, request: NextRequest, finalHandler: FinalHandler) {
    let index = -1;

    function dispatch(i: number): Promise<NextResponse> {
      if (i <= index) {
        return Promise.reject(new Error('next() called multiple times'));
      }
      index = i;

      // 所有中间件执行完毕，执行最终处理器
      if (i === middlewares.length) {
        return finalHandler(ctx, request);
      }

      const fn = middlewares[i];
      if (!fn) {
        return Promise.resolve(NextResponse.json({ error: 'No handler' }, { status: 500 }));
      }

      try {
        return fn(ctx, request, () => dispatch(i + 1));
      } catch (err) {
        return Promise.reject(err);
      }
    }

    return dispatch(0);
  };
}

/**
 * 创建带中间件的 API 处理器
 * @param request Next.js 请求对象
 * @param middlewares 中间件数组
 * @param handler 最终处理函数
 */
export function withMiddlewares(
  request: NextRequest,
  middlewares: Middleware[],
  handler: FinalHandler
): Promise<NextResponse> {
  const ctx: MiddlewareContext = {
    prisma: prisma, // 初始为原始 prisma，中间件可以替换为 scoped 版本
  };

  const composed = compose(middlewares);
  return composed(ctx, request, handler);
}

