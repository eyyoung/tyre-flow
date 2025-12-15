import { NextRequest, NextResponse } from 'next/server';
import { withMiddlewares, adminMiddlewares } from '@/lib/middleware';

// 批量操作门店（管理员专用）
export async function POST(request: NextRequest) {
  return withMiddlewares(request, adminMiddlewares, async (ctx) => {
    try {
      const body = await request.json();
      const { action, ids, reason } = body;

      if (!action || !ids || !Array.isArray(ids) || ids.length === 0) {
        return NextResponse.json(
          { message: 'Invalid request: action and ids are required' },
          { status: 400 }
        );
      }

      if (action === 'disable') {
        // 批量停用
        const result = await ctx.prisma.store.updateMany({
          where: {
            id: { in: ids },
            status: 'ACTIVE', // 只更新当前启用的
          },
          data: {
            status: 'DISABLED',
            disabledAt: new Date(),
            disabledReason: reason || null,
          },
        });

        return NextResponse.json({
          message: 'Stores disabled successfully',
          count: result.count,
        });
      }

      if (action === 'enable') {
        // 批量启用
        const result = await ctx.prisma.store.updateMany({
          where: {
            id: { in: ids },
            status: 'DISABLED', // 只更新当前停用的
          },
          data: {
            status: 'ACTIVE',
            disabledAt: null,
            disabledReason: null,
          },
        });

        return NextResponse.json({
          message: 'Stores enabled successfully',
          count: result.count,
        });
      }

      return NextResponse.json(
        { message: 'Invalid action' },
        { status: 400 }
      );
    } catch (error) {
      console.error('Batch store operation error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}
