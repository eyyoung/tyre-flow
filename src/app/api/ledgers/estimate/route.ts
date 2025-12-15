import { NextRequest, NextResponse } from 'next/server';
import { withMiddlewares, standardMiddlewares } from '@/lib/middleware';

/**
 * 计算建议的目标吨数区间
 * 
 * 算法说明（与 ledger-generator.ts 动态算法匹配）：
 * 
 * 1. 基于车辆运力计算最大产能：
 *    - 每辆车每天最多 12 趟
 *    - 工作时间 10 小时 (8:00-18:00)
 *    - 单次行程时间 = 往返行程 + 装卸(20分钟) + 休息(7.5分钟)
 *    - 每趟平均收集重量 = 车辆最大载重 * 60%
 *    - 车辆最大运力 = 车辆数 * 每天趟数 * 总天数 * 每趟平均重量
 * 
 * 2. 建议区间为最大运力的 70%~95%
 *    - 动态算法可以精确控制到目标的 ±2%
 *    - 所以建议范围可以更宽松
 */
export async function GET(request: NextRequest) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    try {
      const { searchParams } = new URL(request.url);
      const collectionPointId = searchParams.get('collectionPointId');
      const startDateStr = searchParams.get('startDate');
      const endDateStr = searchParams.get('endDate');

      if (!collectionPointId || !startDateStr || !endDateStr) {
        return NextResponse.json(
          { message: '缺少必要参数' },
          { status: 400 }
        );
      }

      const startDate = new Date(startDateStr);
      const endDate = new Date(endDateStr);
      const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

      // 获取门店数量和平均行程时间 - ctx.prisma 已自动带收集点权限过滤
      const allStores = await ctx.prisma.store.findMany({
        where: { collectionPointId, status: 'ACTIVE' },
        select: { estimatedTravelMinutes: true },
      });

      // 过滤掉预估时间为 0 或没有预估时间的门店（与 ledger-generator.ts 保持一致）
      const stores = allStores.filter(
        (store: (typeof allStores)[number]) => store.estimatedTravelMinutes && store.estimatedTravelMinutes > 0
      );

      // 获取收集车辆及其最大载重
      const vehicles = await ctx.prisma.vehicle.findMany({
        where: { collectionPointId, type: 'COLLECTION', status: 'ACTIVE' },
        select: { maxLoad: true },
      });

      const storeCount = stores.length;
      const vehicleCount = vehicles.length;

      if (storeCount === 0 || vehicleCount === 0) {
        return NextResponse.json({
          data: {
            minTonnage: 0,
            maxTonnage: 0,
            storeCount,
            vehicleCount,
            totalDays,
            warning: storeCount === 0 ? '该收集点没有可用门店（所有门店预估时间为空或为0）' : '该收集点没有可用收集车辆',
          },
        });
      }

      // 计算平均行程时间（所有门店都有有效的预估时间）
      type Store = (typeof stores)[number];
      const avgTravelMinutes = stores.reduce((sum: number, s: Store) => sum + s.estimatedTravelMinutes!, 0) / storeCount;

      // 获取车辆最大载重（取最大值，与 ledger-generator.ts 一致）
      const maxVehicleLoad = Math.max(...vehicles.map((v: (typeof vehicles)[number]) => v.maxLoad));
      
      // 平均每次收集重量 = 车辆最大载重 * 60%（与动态算法匹配）
      const avgWeightPerCollection = maxVehicleLoad * 0.6;

      // ===== 基于车辆的最大运力 =====
      // 单次行程时间 = 往返行程 + 装卸时间(20分钟平均) + 休息时间(7.5分钟平均)
      const singleTripMinutes = avgTravelMinutes * 2 + 27.5;
      // 每天工作时间 600 分钟 (10小时: 8:00-18:00)
      const workMinutesPerDay = 600;
      // 每辆车每天实际趟数，最多12趟
      const tripsPerVehiclePerDay = Math.min(12, Math.floor(workMinutesPerDay / singleTripMinutes));
      // 车辆最大运力
      const vehicleMaxCapacity = vehicleCount * tripsPerVehiclePerDay * totalDays * avgWeightPerCollection;

      // ===== 计算建议区间 =====
      // 动态算法可以精确控制到目标 ±2%，所以建议范围可以更宽松
      // 建议区间为最大运力的 70%~95%
      const minTonnage = Math.round(vehicleMaxCapacity * 0.7 / 1000 * 10) / 10; // 转吨，保留1位小数
      const maxTonnage = Math.round(vehicleMaxCapacity * 0.95 / 1000 * 10) / 10;

      return NextResponse.json({
        data: {
          minTonnage,
          maxTonnage,
          storeCount,
          vehicleCount,
          totalDays,
          avgTravelMinutes: Math.round(avgTravelMinutes),
          tripsPerVehiclePerDay,
          avgWeightPerTrip: Math.round(avgWeightPerCollection),
          details: {
            maxVehicleLoadKg: maxVehicleLoad,
            vehicleMaxCapacityKg: Math.round(vehicleMaxCapacity),
          },
        },
      });
    } catch (error) {
      console.error('Estimate tonnage error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}
