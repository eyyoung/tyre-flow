import { NextRequest, NextResponse } from 'next/server';
import { withMiddlewares, standardMiddlewares } from '@/lib/middleware';

// 获取仪表盘统计数据
export async function GET(request: NextRequest) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    try {
      const { searchParams } = new URL(request.url);
      const collectionPointId = searchParams.get('collectionPointId') || '';

      if (!collectionPointId) {
        return NextResponse.json({
          stats: {
            stores: 0,
            vehicles: 0,
            monthlyCollectionWeight: 0,
            monthlyTransferWeight: 0,
          },
          recentTasks: [],
        });
      }

      // 获取本月日期范围
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

      // 并行查询统计数据 - ctx.prisma 已自动带收集点权限过滤
      const [
        storeCount,
        vehicleCount,
        monthlyCollectionWeight,
        monthlyTransferWeight,
        recentTasks,
      ] = await Promise.all([
        // 门店总数
        ctx.prisma.store.count({
          where: { 
            status: 'ACTIVE',
            collectionPointId,
          },
        }),
        // 车辆总数
        ctx.prisma.vehicle.count({
          where: { 
            status: 'ACTIVE',
            collectionPointId,
          },
        }),
        // 本月收集重量（使用卸车净重）
        ctx.prisma.collectionRecord.aggregate({
          where: {
            collectionDate: {
              gte: startOfMonth,
              lte: endOfMonth,
            },
            vehicle: { collectionPointId },
          },
          _sum: {
            unloadingNetWeight: true,
          },
        }),
        // 本月转移重量
        ctx.prisma.transferRecord.aggregate({
          where: {
            transferDate: {
              gte: startOfMonth,
              lte: endOfMonth,
            },
            vehicle: { collectionPointId },
          },
          _sum: {
            unloadingNetWeight: true,
          },
        }),
        // 最近的台账任务
        ctx.prisma.ledgerTask.findMany({
          where: { collectionPointId },
          take: 5,
          orderBy: { createdAt: 'desc' },
        }),
      ]);

      // 分别计算本月收集量和转移量（kg 转换为吨）
      const collectionWeightKg = monthlyCollectionWeight._sum?.unloadingNetWeight || 0;
      const transferWeightKg = monthlyTransferWeight._sum?.unloadingNetWeight || 0;

      return NextResponse.json({
        stats: {
          stores: storeCount,
          vehicles: vehicleCount,
          monthlyCollectionWeight: parseFloat((collectionWeightKg / 1000).toFixed(2)),
          monthlyTransferWeight: parseFloat((transferWeightKg / 1000).toFixed(2)),
        },
        recentTasks: recentTasks.map((task: { id: string; taskNo: string; targetTonnage: number; actualTonnage: number | null; status: string; createdAt: Date }) => ({
          key: task.id,
          taskNo: task.taskNo,
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
  });
}
