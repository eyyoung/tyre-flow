import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAuth } from '@/lib/auth';

interface EstimateConfig {
  collectionIntervalMin: number;
  collectionIntervalMax: number;
  coldStoreRatio: number;
}

async function getConfig(): Promise<EstimateConfig> {
  const configs = await prisma.systemConfig.findMany();
  const configMap = new Map(configs.map(c => [c.key, c.value]));

  return {
    collectionIntervalMin: parseInt(configMap.get('collection_interval_min') || configMap.get('collection_interval_days') || '7'),
    collectionIntervalMax: parseInt(configMap.get('collection_interval_max') || '15'),
    coldStoreRatio: parseFloat(configMap.get('cold_store_ratio') || '0.1'),
  };
}

/**
 * 计算建议的最大目标吨数区间
 * 
 * 算法说明：
 * 1. 基于门店数量：
 *    - 活跃门店 = 总门店 * (1 - 冷门店比例)
 *    - 平均收集间隔 = (最小间隔 + 最大间隔) / 2
 *    - 每个门店收集次数 = 总天数 / 平均收集间隔
 *    - 门店最大产能 = 活跃门店数 * 收集次数 * 平均每次收集重量(800kg)
 * 
 * 2. 基于车辆数量：
 *    - 每辆车每天最多 8 趟
 *    - 工作时间 10 小时 (8:00-18:00)
 *    - 平均单次行程时间 = 平均行程分钟 * 2 + 35(收集+休息)
 *    - 实际每天趟数 = min(8, 600 / 单次行程时间)
 *    - 车辆最大运力 = 车辆数 * 每天趟数 * 总天数 * 平均每次收集重量(800kg)
 * 
 * 3. 建议值取两者较小值的 80%~100% 作为区间
 */
export async function GET(request: NextRequest) {
  return withAuth(request, async () => {
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

      const config = await getConfig();

      // 获取门店数量和平均行程时间
      const stores = await prisma.store.findMany({
        where: { collectionPointId, status: 'ACTIVE' },
        select: { estimatedTravelMinutes: true },
      });

      // 获取收集车辆数量
      const vehicleCount = await prisma.vehicle.count({
        where: { collectionPointId, type: 'COLLECTION', status: 'ACTIVE' },
      });

      const storeCount = stores.length;

      if (storeCount === 0 || vehicleCount === 0) {
        return NextResponse.json({
          data: {
            minTonnage: 0,
            maxTonnage: 0,
            storeCount,
            vehicleCount,
            totalDays,
            warning: storeCount === 0 ? '该收集点没有可用门店' : '该收集点没有可用收集车辆',
          },
        });
      }

      // 计算平均行程时间
      const avgTravelMinutes = stores.reduce((sum, s) => sum + (s.estimatedTravelMinutes || 60), 0) / storeCount;

      // 平均每次收集重量 800 kg
      const avgWeightPerCollection = 800;

      // ===== 基于门店的最大产能 =====
      const activeStoreCount = Math.ceil(storeCount * (1 - config.coldStoreRatio));
      const avgInterval = (config.collectionIntervalMin + config.collectionIntervalMax) / 2;
      const avgCollectionsPerStore = Math.ceil(totalDays / avgInterval);
      const storeMaxCapacity = activeStoreCount * avgCollectionsPerStore * avgWeightPerCollection;

      // ===== 基于车辆的最大运力 =====
      // 单次行程时间 = 往返行程 + 收集时间(20分钟) + 休息时间(15分钟)
      const singleTripMinutes = avgTravelMinutes * 2 + 35;
      // 每天工作时间 600 分钟 (10小时)
      const workMinutesPerDay = 600;
      // 每辆车每天实际趟数，最多8趟
      const tripsPerVehiclePerDay = Math.min(8, Math.floor(workMinutesPerDay / singleTripMinutes));
      // 车辆最大运力
      const vehicleMaxCapacity = vehicleCount * tripsPerVehiclePerDay * totalDays * avgWeightPerCollection;

      // ===== 计算建议区间 =====
      // 取两者较小值
      const effectiveMaxCapacity = Math.min(storeMaxCapacity, vehicleMaxCapacity);
      // 建议区间为最大产能的 60%~90%，留有余地
      const minTonnage = Math.round(effectiveMaxCapacity * 0.6 / 1000 * 10) / 10; // 转吨，保留1位小数
      const maxTonnage = Math.round(effectiveMaxCapacity * 0.9 / 1000 * 10) / 10;

      // 确定瓶颈
      const bottleneck = storeMaxCapacity < vehicleMaxCapacity ? 'store' : 'vehicle';

      return NextResponse.json({
        data: {
          minTonnage,
          maxTonnage,
          storeCount,
          activeStoreCount,
          vehicleCount,
          totalDays,
          avgTravelMinutes: Math.round(avgTravelMinutes),
          tripsPerVehiclePerDay,
          bottleneck,
          details: {
            storeMaxCapacityKg: Math.round(storeMaxCapacity),
            vehicleMaxCapacityKg: Math.round(vehicleMaxCapacity),
            effectiveMaxCapacityKg: Math.round(effectiveMaxCapacity),
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
