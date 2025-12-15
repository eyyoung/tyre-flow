import { NextRequest, NextResponse } from 'next/server';
import { withMiddlewares, standardMiddlewares } from '@/lib/middleware';

// 获取单个转移任务
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    try {
      const { id } = await params;
      
      // ctx.prisma 已自动带收集点权限过滤
      const task = await ctx.prisma.transferTask.findUnique({
        where: { id },
        include: {
          collectionPoint: {
            select: { id: true, name: true, code: true },
          },
          _count: {
            select: { transferRecords: true },
          },
        },
      });

      if (!task) {
        return NextResponse.json(
          { error: '转移任务不存在' },
          { status: 404 }
        );
      }

      return NextResponse.json(task);
    } catch (error) {
      console.error('Error fetching transfer task:', error);
      return NextResponse.json(
        { error: '获取转移任务失败' },
        { status: 500 }
      );
    }
  });
}

// 删除转移任务
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    // 只有管理员可以删除任务
    if (ctx.user?.role !== 'ADMIN') {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    try {
      const { id } = await params;

      // 检查任务是否存在
      const task = await ctx.prisma.transferTask.findUnique({
        where: { id },
      });

      if (!task) {
        return NextResponse.json(
          { error: '转移任务不存在' },
          { status: 404 }
        );
      }

      // 删除任务（关联的记录会因为 onDelete: Cascade 自动删除）
      await ctx.prisma.transferTask.delete({
        where: { id },
      });

      return NextResponse.json({ message: '删除成功' });
    } catch (error) {
      console.error('Error deleting transfer task:', error);
      return NextResponse.json(
        { error: '删除转移任务失败' },
        { status: 500 }
      );
    }
  });
}
