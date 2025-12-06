import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAuth, isAdmin } from '@/lib/auth';

// 获取台账任务列表
export async function GET(request: NextRequest) {
  return withAuth(request, async (user) => {
    try {
      const { searchParams } = new URL(request.url);
      const page = parseInt(searchParams.get('page') || '1');
      const pageSize = parseInt(searchParams.get('pageSize') || '10');
      const status = searchParams.get('status') || '';
      const collectionPointId = searchParams.get('collectionPointId') || '';
      const year = searchParams.get('year') || '';
      const month = searchParams.get('month') || '';

      // 非管理员只能看到自己绑定的收集点的任务
      let allowedCollectionPointIds: string[] | null = null;
      if (!isAdmin(user)) {
        const bindings = await prisma.userCollectionPoint.findMany({
          where: { userId: user.userId },
          select: { collectionPointId: true },
        });
        allowedCollectionPointIds = bindings.map((b) => b.collectionPointId);
      }

      const where = {
        AND: [
          status ? { status: status as 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' } : {},
          collectionPointId ? { collectionPointId } : {},
          year ? { year: parseInt(year) } : {},
          month ? { month: parseInt(month) } : {},
          allowedCollectionPointIds
            ? { collectionPointId: { in: allowedCollectionPointIds } }
            : {},
        ],
      };

      const [total, tasks] = await Promise.all([
        prisma.ledgerTask.count({ where }),
        prisma.ledgerTask.findMany({
          where,
          include: {
            collectionPoint: {
              select: { id: true, name: true, code: true },
            },
            _count: {
              select: {
                collectionRecords: true,
              },
            },
          },
          orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      return NextResponse.json({
        data: tasks,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      });
    } catch (error) {
      console.error('Get ledger tasks error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

// 创建台账任务
export async function POST(request: NextRequest) {
  return withAuth(request, async (user) => {
    if (!isAdmin(user)) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    try {
      const body = await request.json();
      const { collectionPointId, year, month, targetTonnage } = body;

      // 验证必填字段
      if (!collectionPointId || !year || !month || !targetTonnage) {
        return NextResponse.json(
          { message: 'Collection point, year, month and target tonnage are required' },
          { status: 400 }
        );
      }

      // 检查收集点是否存在
      const collectionPoint = await prisma.collectionPoint.findUnique({
        where: { id: collectionPointId },
      });

      if (!collectionPoint) {
        return NextResponse.json(
          { message: 'Collection point not found' },
          { status: 400 }
        );
      }

      // 检查是否已存在相同年月的任务
      const existing = await prisma.ledgerTask.findFirst({
        where: { collectionPointId, year: parseInt(year), month: parseInt(month) },
      });

      if (existing) {
        return NextResponse.json(
          { message: '该收集点在该年月已存在台账任务' },
          { status: 400 }
        );
      }

      // 生成任务编号
      const taskNo = `LT-${year}${String(month).padStart(2, '0')}-${collectionPoint.code}-${Date.now().toString(36).toUpperCase()}`;

      const task = await prisma.ledgerTask.create({
        data: {
          taskNo,
          year: parseInt(year),
          month: parseInt(month),
          targetTonnage: parseFloat(targetTonnage),
          collectionPointId,
        },
        include: {
          collectionPoint: {
            select: { id: true, name: true, code: true },
          },
        },
      });

      return NextResponse.json({ data: task }, { status: 201 });
    } catch (error) {
      console.error('Create ledger task error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

