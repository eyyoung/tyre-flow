import { NextRequest, NextResponse } from 'next/server';
import { withMiddlewares, standardMiddlewares } from '@/lib/middleware';
import { executeLedgerTask } from '@/lib/ledger-generator';

// 获取台账任务列表
export async function GET(request: NextRequest) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    try {
      const { searchParams } = new URL(request.url);
      const page = parseInt(searchParams.get('page') || '1');
      const pageSize = parseInt(searchParams.get('pageSize') || '10');
      const statusParam = searchParams.get('status') || '';
      const collectionPointId = searchParams.get('collectionPointId') || '';

      // 验证 status 是否为有效的 TaskStatus 枚举值
      const validStatuses = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'] as const;
      type TaskStatus = (typeof validStatuses)[number];
      const status: TaskStatus | null = validStatuses.includes(statusParam as TaskStatus)
        ? (statusParam as TaskStatus)
        : null;

      // ctx.prisma 已自动带收集点权限过滤，无需手动检查
      const where = {
        AND: [
          status ? { status } : {},
          collectionPointId ? { collectionPointId } : {},
        ],
      };

      const [total, tasks] = await Promise.all([
        ctx.prisma.ledgerTask.count({ where }),
        ctx.prisma.ledgerTask.findMany({
          where,
          include: {
            collectionPoint: {
              select: { id: true, name: true, nameTranslations: true, code: true },
            },
            _count: {
              select: {
                collectionRecords: true,
              },
            },
          },
          orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
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

// 创建并同步生成收集任务
export async function POST(request: NextRequest) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    // 只有管理员可以创建任务
    if (ctx.user?.role !== 'ADMIN') {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    try {
      const body = await request.json();
      const { collectionPointId, startDate, endDate, targetTonnage, maxTripsPerVehiclePerDay = 2 } = body;

      // 验证必填字段
      if (!collectionPointId || !startDate || !endDate || !targetTonnage) {
        return NextResponse.json(
          { message: 'Collection point, start date, end date and target tonnage are required' },
          { status: 400 }
        );
      }

      const start = new Date(startDate);
      const end = new Date(endDate);

      if (start > end) {
        return NextResponse.json(
          { message: '开始日期不能晚于结束日期' },
          { status: 400 }
        );
      }

      // 检查收集点是否存在
      const collectionPoint = await ctx.prisma.collectionPoint.findUnique({
        where: { id: collectionPointId },
      });

      if (!collectionPoint) {
        return NextResponse.json(
          { message: 'Collection point not found' },
          { status: 400 }
        );
      }

      // 检查是否已存在相同时间范围的任务
      const existing = await ctx.prisma.ledgerTask.findFirst({
        where: {
          collectionPointId,
          startDate: start,
          endDate: end,
        },
      });

      if (existing) {
        return NextResponse.json(
          { message: '该收集点在该时间范围已存在收集任务' },
          { status: 400 }
        );
      }

      // 生成任务编号
      const startStr = startDate.replace(/-/g, '');
      const endStr = endDate.replace(/-/g, '');
      const taskNo = `LT-${startStr}-${endStr}-${collectionPoint.code}-${Date.now().toString(36).toUpperCase()}`;

      // 创建任务
      const task = await ctx.prisma.ledgerTask.create({
        data: {
          taskNo,
          startDate: start,
          endDate: end,
          targetTonnage: parseFloat(targetTonnage),
          maxTripsPerVehiclePerDay: parseInt(maxTripsPerVehiclePerDay) || 2,
          collectionPointId,
          status: 'PENDING',
        },
      });

      // 同步执行生成
      const result = await executeLedgerTask(task.id);

      // 获取更新后的任务信息
      const updatedTask = await ctx.prisma.ledgerTask.findUnique({
        where: { id: task.id },
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
      });

      return NextResponse.json({
        data: updatedTask,
        summary: result,
      }, { status: 201 });
    } catch (error) {
      console.error('Create ledger task error:', error);
      return NextResponse.json(
        { message: error instanceof Error ? error.message : 'Internal server error' },
        { status: 500 }
      );
    }
  });
}
