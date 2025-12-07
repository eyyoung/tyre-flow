import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { executeTransferTask } from '@/lib/transfer-generator';

// 获取转移任务列表
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '10');
    const status = searchParams.get('status') || '';
    const collectionPointId = searchParams.get('collectionPointId') || '';

    const where: Record<string, unknown> = {};

    if (status) {
      where.status = status;
    }

    if (collectionPointId) {
      where.collectionPointId = collectionPointId;
    }

    const [total, data] = await Promise.all([
      prisma.transferTask.count({ where }),
      prisma.transferTask.findMany({
        where,
        include: {
          collectionPoint: {
            select: { id: true, name: true, code: true },
          },
          _count: {
            select: { transferRecords: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return NextResponse.json({
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    console.error('Error fetching transfer tasks:', error);
    return NextResponse.json(
      { error: '获取转移任务列表失败' },
      { status: 500 }
    );
  }
}

// 创建转移任务并立即执行
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { collectionPointId, startDate, endDate, targetTonnage } = body;

    if (!collectionPointId || !startDate || !endDate || !targetTonnage) {
      return NextResponse.json(
        { error: '收集点、时间范围和目标重量为必填项' },
        { status: 400 }
      );
    }

    // 检查收集点是否存在
    const collectionPoint = await prisma.collectionPoint.findUnique({
      where: { id: collectionPointId },
    });

    if (!collectionPoint) {
      return NextResponse.json(
        { error: '收集点不存在' },
        { status: 400 }
      );
    }

    // 检查是否有可用的转移车辆
    const transferVehicleCount = await prisma.vehicle.count({
      where: {
        collectionPointId,
        type: 'TRANSFER',
        status: 'ACTIVE',
      },
    });

    if (transferVehicleCount === 0) {
      return NextResponse.json(
        { error: '该收集点没有可用的转移车辆' },
        { status: 400 }
      );
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    // 检查是否已存在相同时间范围的任务
    const existingTask = await prisma.transferTask.findFirst({
      where: {
        collectionPointId,
        startDate: start,
        endDate: end,
      },
    });

    if (existingTask) {
      return NextResponse.json(
        { error: '该收集点在此时间范围内已存在转移任务' },
        { status: 400 }
      );
    }

    // 生成任务编号
    const startStr = startDate.replace(/-/g, '');
    const endStr = endDate.replace(/-/g, '');
    const count = await prisma.transferTask.count();
    const taskNo = `TT-${startStr}-${endStr}-${String(count + 1).padStart(4, '0')}`;

    // 创建任务
    const task = await prisma.transferTask.create({
      data: {
        taskNo,
        startDate: start,
        endDate: end,
        targetTonnage: parseFloat(targetTonnage), // 已经是 kg
        collectionPointId,
      },
    });

    // 立即执行生成任务
    const summary = await executeTransferTask(task.id);

    return NextResponse.json({ task, summary }, { status: 201 });
  } catch (error) {
    console.error('Error creating transfer task:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '创建转移任务失败' },
      { status: 500 }
    );
  }
}
