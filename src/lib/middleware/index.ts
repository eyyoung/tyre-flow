export * from './types';
export * from './compose';
export * from './auth';
export * from './collection-point-scope';
export * from './audit-log';

import { Middleware } from './types';
import { authMiddleware, adminOnlyMiddleware } from './auth';
import { collectionPointScopeMiddleware } from './collection-point-scope';

/**
 * 预设中间件组合 - 标准 API（需要认证 + 收集点权限）
 * 适用于大多数业务 API
 */
export const standardMiddlewares: Middleware[] = [
  authMiddleware,
  collectionPointScopeMiddleware,
];

/**
 * 预设中间件组合 - 仅认证（不需要收集点过滤）
 * 适用于用户信息、设置等与收集点无关的 API
 */
export const authOnlyMiddlewares: Middleware[] = [
  authMiddleware,
];

/**
 * 预设中间件组合 - 管理员 API（需要管理员权限）
 */
export const adminMiddlewares: Middleware[] = [
  authMiddleware,
  adminOnlyMiddleware,
  collectionPointScopeMiddleware,
];

/**
 * 预设中间件组合 - 公开 API（无需认证）
 */
export const publicMiddlewares: Middleware[] = [];


