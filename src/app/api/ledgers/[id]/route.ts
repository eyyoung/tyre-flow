import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAuth, isAdmin } from '@/lib/auth';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// 获取单个台账任务详情
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withAuth(request, async (user) => {
    const { id } = await params;

    try {
      const task = await prisma.ledgerTask.findUnique({
        where: { id },
        include: {
          collectionPoint: {
            select: { id: true, name: true, code: true, address: true },
          },
          _count: {
            select: {
              collectionRecords: true,
            },
          },
        },
      });

      if (!task) {
        return NextResponse.json({ message: 'Task not found' }, { status: 404 });
      }

      // 非管理员检查权限
      if (!isAdmin(user)) {
        const binding = await prisma.userCollectionPoint.findUnique({
          where: {
            userId_collectionPointId: {
              userId: user.userId,
              collectionPointId: task.collectionPointId,
            },
          },
        });

        if (!binding) {
          return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
        }
      }

      return NextResponse.json({ data: task });
    } catch (error) {
      console.error('Get ledger task error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

// 删除台账任务
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withAuth(request, async (user) => {
    if (!isAdmin(user)) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;

    try {
      const task = await prisma.ledgerTask.findUnique({
        where: { id },
      });

      if (!task) {
        return NextResponse.json({ message: 'Task not found' }, { status: 404 });
      }

      // 删除任务（级联删除会自动删除关联的记录）
      await prisma.ledgerTask.delete({
        where: { id },
      });

      return NextResponse.json({ message: 'Task deleted successfully' });
    } catch (error) {
      console.error('Delete ledger task error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

