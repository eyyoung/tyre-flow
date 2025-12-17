import { Middleware } from './types';

/**
 * 审计日志中间件 - 记录 API 访问
 * 这是一个示例中间件，展示洋葱模型的后置处理能力
 */
export const auditLogMiddleware: Middleware = async (ctx, request, next) => {
  const startTime = Date.now();

  // 执行后续中间件和处理器
  const response = await next();

  // 记录日志（洋葱模型的返回阶段）
  const duration = Date.now() - startTime;
  
  // 仅在开发环境或启用审计日志时记录
  if (process.env.NODE_ENV === 'development' || process.env.ENABLE_AUDIT_LOG === 'true') {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      method: request.method,
      path: request.nextUrl.pathname,
      userId: ctx.user?.userId,
      username: ctx.user?.username,
      role: ctx.user?.role,
      duration,
      status: response.status,
    }));
  }

  return response;
};


