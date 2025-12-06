import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

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

// 创建转移任务
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { collectionPointId, targetTonnage } = body;

    if (!collectionPointId || !targetTonnage) {
      return NextResponse.json(
        { error: '收集点和目标吨数为必填项' },
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

    // 生成任务编号
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const count = await prisma.transferTask.count();
    const taskNo = `TT-${dateStr}-${String(count + 1).padStart(4, '0')}`;

    const task = await prisma.transferTask.create({
      data: {
        taskNo,
        targetTonnage: parseFloat(targetTonnage),
        collectionPointId,
      },
      include: {
        collectionPoint: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    console.error('Error creating transfer task:', error);
    return NextResponse.json(
      { error: '创建转移任务失败' },
      { status: 500 }
    );
  }
}

