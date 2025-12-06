import { NextResponse } from 'next/server';
import prisma from '@/lib/db';

// 获取仪表盘统计数据
export async function GET() {
  try {
    // 获取本月日期范围
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // 并行查询统计数据
    const [
      collectionPointCount,
      storeCount,
      vehicleCount,
      monthlyCollectionWeight,
      monthlyTransferWeight,
      recentTasks,
    ] = await Promise.all([
      // 收集点总数
      prisma.collectionPoint.count({
        where: { status: 'ACTIVE' },
      }),
      // 门店总数
      prisma.store.count({
        where: { status: 'ACTIVE' },
      }),
      // 车辆总数
      prisma.vehicle.count({
        where: { status: 'ACTIVE' },
      }),
      // 本月收集重量
      prisma.collectionRecord.aggregate({
        where: {
          collectionDate: {
            gte: startOfMonth,
            lte: endOfMonth,
          },
        },
        _sum: {
          weight: true,
        },
      }),
      // 本月转移重量
      prisma.transferRecord.aggregate({
        where: {
          transferDate: {
            gte: startOfMonth,
            lte: endOfMonth,
          },
        },
        _sum: {
          netWeight: true,
        },
      }),
      // 最近的台账任务
      prisma.ledgerTask.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          collectionPoint: {
            select: { name: true },
          },
        },
      }),
    ]);

    // 计算本月总吨数（收集 + 转移）
    const collectionWeight = monthlyCollectionWeight._sum.weight || 0;
    const transferWeight = monthlyTransferWeight._sum.netWeight || 0;
    const monthlyTonnage = collectionWeight + transferWeight;

    return NextResponse.json({
      stats: {
        collectionPoints: collectionPointCount,
        stores: storeCount,
        vehicles: vehicleCount,
        monthlyTonnage: parseFloat(monthlyTonnage.toFixed(2)),
      },
      recentTasks: recentTasks.map((task) => ({
        key: task.id,
        taskNo: task.taskNo,
        collectionPoint: task.collectionPoint.name,
        targetTonnage: task.targetTonnage,
        actualTonnage: task.actualTonnage,
        status: task.status.toLowerCase(),
        createdAt: task.createdAt.toISOString().slice(0, 10),
      })),
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    return NextResponse.json(
      { error: '获取统计数据失败' },
      { status: 500 }
    );
  }
}

