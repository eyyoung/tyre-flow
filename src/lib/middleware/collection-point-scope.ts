import { Middleware } from './types';
import prisma from '@/lib/db';

/**
 * 收集点范围中间件 - 自动过滤用户可访问的收集点
 * 注意：必须在 authMiddleware 之后使用
 */
export const collectionPointScopeMiddleware: Middleware = async (ctx, request, next) => {
  // 未认证或管理员，不做过滤
  if (!ctx.user || ctx.user.role === 'ADMIN') {
    return next();
  }

  const collectionPointIds = ctx.user.collectionPointIds || [];

  // 如果用户没有绑定任何收集点，返回空结果的 prisma 客户端
  if (collectionPointIds.length === 0) {
    ctx.prisma = prisma.$extends({
      query: {
        $allModels: {
          async findMany() {
            return [];
          },
          async findFirst() {
            return null;
          },
          async count() {
            return 0;
          },
        },
      },
    });
    return next();
  }

  // 创建带权限范围的 Prisma 客户端
  ctx.prisma = prisma.$extends({
    query: {
      // 门店：通过 collectionPointId 过滤
      store: {
        async findMany({ args, query }) {
          args.where = { ...args.where, collectionPointId: { in: collectionPointIds } };
          return query(args);
        },
        async findFirst({ args, query }) {
          args.where = { ...args.where, collectionPointId: { in: collectionPointIds } };
          return query(args);
        },
        async findUnique({ args, query }) {
          const result = await query(args);
          if (result && result.collectionPointId && !collectionPointIds.includes(result.collectionPointId)) {
            return null;
          }
          return result;
        },
        async count({ args, query }) {
          args.where = { ...args.where, collectionPointId: { in: collectionPointIds } };
          return query(args);
        },
      },

      // 车辆
      vehicle: {
        async findMany({ args, query }) {
          args.where = { ...args.where, collectionPointId: { in: collectionPointIds } };
          return query(args);
        },
        async findFirst({ args, query }) {
          args.where = { ...args.where, collectionPointId: { in: collectionPointIds } };
          return query(args);
        },
        async findUnique({ args, query }) {
          const result = await query(args);
          if (result && result.collectionPointId && !collectionPointIds.includes(result.collectionPointId)) {
            return null;
          }
          return result;
        },
        async count({ args, query }) {
          args.where = { ...args.where, collectionPointId: { in: collectionPointIds } };
          return query(args);
        },
      },

      // 收集点本身
      collectionPoint: {
        async findMany({ args, query }) {
          args.where = { ...args.where, id: { in: collectionPointIds } };
          return query(args);
        },
        async findFirst({ args, query }) {
          args.where = { ...args.where, id: { in: collectionPointIds } };
          return query(args);
        },
        async findUnique({ args, query }) {
          const result = await query(args);
          if (result && result.id && !collectionPointIds.includes(result.id)) {
            return null;
          }
          return result;
        },
        async count({ args, query }) {
          args.where = { ...args.where, id: { in: collectionPointIds } };
          return query(args);
        },
      },

      // 收集任务（台账）
      ledgerTask: {
        async findMany({ args, query }) {
          args.where = { ...args.where, collectionPointId: { in: collectionPointIds } };
          return query(args);
        },
        async findFirst({ args, query }) {
          args.where = { ...args.where, collectionPointId: { in: collectionPointIds } };
          return query(args);
        },
        async findUnique({ args, query }) {
          const result = await query(args);
          if (result && result.collectionPointId && !collectionPointIds.includes(result.collectionPointId)) {
            return null;
          }
          return result;
        },
        async count({ args, query }) {
          args.where = { ...args.where, collectionPointId: { in: collectionPointIds } };
          return query(args);
        },
      },

      // 转移任务
      transferTask: {
        async findMany({ args, query }) {
          args.where = { ...args.where, collectionPointId: { in: collectionPointIds } };
          return query(args);
        },
        async findFirst({ args, query }) {
          args.where = { ...args.where, collectionPointId: { in: collectionPointIds } };
          return query(args);
        },
        async findUnique({ args, query }) {
          const result = await query(args);
          if (result && result.collectionPointId && !collectionPointIds.includes(result.collectionPointId)) {
            return null;
          }
          return result;
        },
        async count({ args, query }) {
          args.where = { ...args.where, collectionPointId: { in: collectionPointIds } };
          return query(args);
        },
      },

      // 收集记录：通过关联的 task 过滤
      collectionRecord: {
        async findMany({ args, query }) {
          args.where = {
            ...args.where,
            task: { collectionPointId: { in: collectionPointIds } },
          };
          return query(args);
        },
        async findFirst({ args, query }) {
          args.where = {
            ...args.where,
            task: { collectionPointId: { in: collectionPointIds } },
          };
          return query(args);
        },
        async count({ args, query }) {
          args.where = {
            ...args.where,
            task: { collectionPointId: { in: collectionPointIds } },
          };
          return query(args);
        },
      },

      // 转移记录
      transferRecord: {
        async findMany({ args, query }) {
          args.where = {
            ...args.where,
            task: { collectionPointId: { in: collectionPointIds } },
          };
          return query(args);
        },
        async findFirst({ args, query }) {
          args.where = {
            ...args.where,
            task: { collectionPointId: { in: collectionPointIds } },
          };
          return query(args);
        },
        async count({ args, query }) {
          args.where = {
            ...args.where,
            task: { collectionPointId: { in: collectionPointIds } },
          };
          return query(args);
        },
      },
    },
  });

  return next();
};

