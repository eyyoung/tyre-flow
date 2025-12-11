/**
 * 路径规划定时任务调度器
 * 每 1 分钟检测一次，如果有待处理门店且没有任务在运行，则启动处理任务
 */

import prisma from './db';
import { 
  getLocationService, 
  getQPSDelay, 
  getLBSProviderType,
  type LocationServiceProvider 
} from './location-service';

// 任务运行标记
let isTaskRunning = false;

// 获取收集点坐标（如果没有则进行地理编码）
async function getCollectionPointCoords(
  collectionPointId: string,
  locationService: LocationServiceProvider
): Promise<{ longitude: number; latitude: number } | null> {
  const collectionPoint = await prisma.collectionPoint.findUnique({
    where: { id: collectionPointId },
  });

  if (!collectionPoint) return null;

  if (collectionPoint.longitude && collectionPoint.latitude) {
    return {
      longitude: collectionPoint.longitude,
      latitude: collectionPoint.latitude,
    };
  }

  // 需要先对收集点进行地理编码
  const fullAddress = [
    collectionPoint.province,
    collectionPoint.city,
    collectionPoint.district,
    collectionPoint.address,
  ].filter(Boolean).join('');

  try {
    const geocodeResult = await locationService.geocode(fullAddress);

    if (geocodeResult.success && geocodeResult.longitude && geocodeResult.latitude) {
      const { longitude, latitude } = geocodeResult;

      // 更新收集点坐标
      await prisma.collectionPoint.update({
        where: { id: collectionPointId },
        data: { longitude, latitude },
      });

      return { longitude, latitude };
    }
  } catch (error) {
    console.error('[RoutePlanScheduler] Collection point geocode error:', error);
  }

  return null;
}

// 获取待处理门店数量
async function getPendingStoreCount(): Promise<number> {
  try {
    return await prisma.store.count({
      where: {
        isVirtual: false,
        status: 'ACTIVE',
        longitude: { not: null, notIn: [0] },
        latitude: { not: null, notIn: [0] },
        estimatedTravelMinutes: 0,
      },
    });
  } catch {
    return 0;
  }
}

// 执行完整的路径规划任务（处理所有待规划门店）
async function runFullRoutePlanTask() {
  // 设置运行标记
  isTaskRunning = true;
  const providerType = getLBSProviderType();
  console.log(`[RoutePlanScheduler] Task started (provider: ${providerType})`);

  try {
    // 获取位置服务
    const locationService = await getLocationService();
    if (!locationService) {
      console.log('[RoutePlanScheduler] No API key configured, task skipped');
      return;
    }

    // 缓存收集点坐标
    const collectionPointCoords = new Map<string, { longitude: number; latitude: number } | null>();
    
    let totalProcessed = 0;
    let totalSuccess = 0;
    let totalFailed = 0;

    const qpsDelay = getQPSDelay();

    // 循环处理，每次批量获取一批门店
    const batchSize = 50; // 每批获取50个门店
    
    while (true) {
      // 查找需要路径规划的门店（排除坐标为 0,0 的门店）
      const pendingStores = await prisma.store.findMany({
        where: {
          isVirtual: false,
          status: 'ACTIVE',
          longitude: { not: null, notIn: [0] },
          latitude: { not: null, notIn: [0] },
          estimatedTravelMinutes: 0,
        },
        take: batchSize,
        include: {
          collectionPoint: {
            select: {
              id: true,
              longitude: true,
              latitude: true,
            },
          },
        },
      });

      // 没有更多待处理门店，退出循环
      if (pendingStores.length === 0) {
        break;
      }

      console.log(`[RoutePlanScheduler] Processing batch of ${pendingStores.length} stores...`);

      for (const store of pendingStores) {
        const cpId = store.collectionPointId;
        
        // 获取或缓存收集点坐标
        if (!collectionPointCoords.has(cpId)) {
          const coords = await getCollectionPointCoords(cpId, locationService);
          collectionPointCoords.set(cpId, coords);
        }

        const destCoords = collectionPointCoords.get(cpId);
        if (!destCoords) {
          console.log(`[RoutePlanScheduler] Skipping store ${store.code}: collection point has no coordinates`);
          totalFailed++;
          continue;
        }

        // 执行路径规划
        const result = await locationService.planRoute(
          store.longitude!,
          store.latitude!,
          destCoords.longitude,
          destCoords.latitude
        );

        totalProcessed++;

        if (result.success && result.duration) {
          await prisma.store.update({
            where: { id: store.id },
            data: { estimatedTravelMinutes: result.duration },
          });
          totalSuccess++;
          console.log(`[RoutePlanScheduler] ✓ Store ${store.code}: ${result.duration} min (${totalProcessed} processed)`);
        } else {
          // 路径规划失败，重置坐标为 0,0（便于重新地理编码）
          await prisma.store.update({
            where: { id: store.id },
            data: { longitude: 0, latitude: 0 },
          });
          totalFailed++;
          console.log(`[RoutePlanScheduler] ✗ Store ${store.code}: ${result.error} (coordinates reset)`);
        }

        // 添加延迟避免超过QPS限制
        await new Promise(resolve => setTimeout(resolve, qpsDelay));
      }
    }

    if (totalProcessed > 0) {
      console.log(`[RoutePlanScheduler] Task completed: ${totalProcessed} processed, ${totalSuccess} success, ${totalFailed} failed`);
    }
  } catch (error) {
    console.error('[RoutePlanScheduler] Task error:', error);
  } finally {
    // 清除运行标记
    isTaskRunning = false;
    console.log('[RoutePlanScheduler] Task ended');
  }
}

// 检测并触发任务
async function checkAndTriggerTask() {
  // 如果已有任务在运行，跳过
  if (isTaskRunning) {
    return;
  }

  try {
    // 检查是否有待处理的门店
    const pendingCount = await getPendingStoreCount();
    
    if (pendingCount > 0) {
      console.log(`[RoutePlanScheduler] Found ${pendingCount} pending stores, starting task...`);
      // 异步启动任务，不阻塞检测循环
      runFullRoutePlanTask();
    }
  } catch (error) {
    console.error('[RoutePlanScheduler] Check error:', error);
  }
}

let schedulerInterval: NodeJS.Timeout | null = null;

/**
 * 启动路径规划定时任务调度器
 * 每 1 分钟检测一次，如果有待处理门店且没有任务在运行，则启动处理任务
 */
export function startRoutePlanScheduler() {
  if (schedulerInterval) {
    console.log('[RoutePlanScheduler] Already running');
    return;
  }

  const providerType = getLBSProviderType();
  console.log(`[RoutePlanScheduler] Starting scheduler (check interval: 1min, provider: ${providerType})...`);
  
  // 延迟 10 秒后开始第一次检测，等待数据库连接稳定
  setTimeout(() => {
    // 立即检测一次
    checkAndTriggerTask();
    
    // 设置定时器，每 1 分钟检测一次
    schedulerInterval = setInterval(checkAndTriggerTask, 60000);
  }, 10000);
}

/**
 * 停止路径规划定时任务调度器
 */
export function stopRoutePlanScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[RoutePlanScheduler] Scheduler stopped');
  }
}

/**
 * 获取任务运行状态
 */
export function isRoutePlanTaskRunning(): boolean {
  return isTaskRunning;
}
