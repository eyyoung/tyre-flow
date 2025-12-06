import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAuth, isAdmin } from '@/lib/auth';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// 获取台账记录
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withAuth(request, async (user) => {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'collection'; // collection only (transfer moved to TransferTask)
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');

    try {
      // 检查任务是否存在
      const task = await prisma.ledgerTask.findUnique({
        where: { id },
        select: { id: true, collectionPointId: true },
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

      // 只返回收集记录（转移记录已移至 TransferTask）
      const [total, records] = await Promise.all([
        prisma.collectionRecord.count({ where: { taskId: id } }),
        prisma.collectionRecord.findMany({
          where: { taskId: id },
          include: {
            store: {
              select: { id: true, code: true, name: true, address: true },
            },
            vehicle: {
              select: { id: true, plateNumber: true },
            },
          },
          orderBy: { collectionDate: 'asc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      return NextResponse.json({
        data: records,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      });
    } catch (error) {
      console.error('Get ledger records error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

