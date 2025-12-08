/**
 * 路径规划定时任务调度器
 * 每 1 分钟检测一次，如果有待处理门店且没有任务在运行，则启动处理任务
 */

import prisma from './db';

interface AmapDirectionResponse {
  status: string;
  info: string;
  infocode: string;
  count: string;
  route: {
    origin: string;
    destination: string;
    paths: Array<{
      distance: string;
      duration: string;
      strategy: string;
    }>;
  };
}

// 高德地图驾车路径规划API
const AMAP_DIRECTION_URL = 'https://restapi.amap.com/v3/direction/driving';

// 任务运行标记
let isTaskRunning = false;

// 从环境变量获取高德地图API Key
const getAmapKey = async (): Promise<string | null> => {
  if (process.env.AMAP_API_KEY) {
    return process.env.AMAP_API_KEY;
  }
  
  try {
    const config = await prisma.systemConfig.findUnique({
      where: { key: 'amap_api_key' },
    });
    return config?.value || null;
  } catch {
    return null;
  }
};

// 获取收集点坐标（如果没有则进行地理编码）
async function getCollectionPointCoords(
  collectionPointId: string,
  apiKey: string
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
  const geocodeUrl = new URL('https://restapi.amap.com/v3/geocode/geo');
  const fullAddress = [
    collectionPoint.province,
    collectionPoint.city,
    collectionPoint.district,
    collectionPoint.address,
  ].filter(Boolean).join('');
  
  geocodeUrl.searchParams.set('address', fullAddress);
  geocodeUrl.searchParams.set('key', apiKey);
  geocodeUrl.searchParams.set('output', 'JSON');

  try {
    const geocodeResponse = await fetch(geocodeUrl.toString());
    const geocodeData = await geocodeResponse.json();

    if (geocodeData.status === '1' && geocodeData.geocodes && geocodeData.geocodes.length > 0) {
      const location = geocodeData.geocodes[0].location;
      const [lng, lat] = location.split(',').map(Number);

      // 更新收集点坐标
      await prisma.collectionPoint.update({
        where: { id: collectionPointId },
        data: { longitude: lng, latitude: lat },
      });

      return { longitude: lng, latitude: lat };
    }
  } catch (error) {
    console.error('[RoutePlanScheduler] Collection point geocode error:', error);
  }

  return null;
}

// 单个路径规划
async function planRoute(
  originLng: number,
  originLat: number,
  destLng: number,
  destLat: number,
  apiKey: string
): Promise<{ success: boolean; duration?: number; distance?: number; error?: string }> {
  try {
    const url = new URL(AMAP_DIRECTION_URL);
    url.searchParams.set('origin', `${originLng},${originLat}`);
    url.searchParams.set('destination', `${destLng},${destLat}`);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('output', 'JSON');
    url.searchParams.set('strategy', '0'); // 速度优先

    const response = await fetch(url.toString());
    const data: AmapDirectionResponse = await response.json();

    if (data.status !== '1') {
      return { success: false, error: `API Error: ${data.info}` };
    }

    if (!data.route || !data.route.paths || data.route.paths.length === 0) {
      return { success: false, error: '未找到可行路线' };
    }

    const path = data.route.paths[0];
    const durationSeconds = parseInt(path.duration);

    if (isNaN(durationSeconds)) {
      return { success: false, error: '时间格式无效' };
    }

    // 转换为分钟，向上取整
    const durationMinutes = Math.ceil(durationSeconds / 60);

    return { 
      success: true, 
      duration: durationMinutes,
      distance: parseInt(path.distance),
    };
  } catch (error) {
    return { success: false, error: `请求失败: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
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
  console.log('[RoutePlanScheduler] Task started');

  try {
    // 获取 API Key
    const apiKey = await getAmapKey();
    if (!apiKey) {
      console.log('[RoutePlanScheduler] No API key configured, task skipped');
      return;
    }

    // 缓存收集点坐标
    const collectionPointCoords = new Map<string, { longitude: number; latitude: number } | null>();
    
    let totalProcessed = 0;
    let totalSuccess = 0;
    let totalFailed = 0;

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
          const coords = await getCollectionPointCoords(cpId, apiKey);
          collectionPointCoords.set(cpId, coords);
        }

        const destCoords = collectionPointCoords.get(cpId);
        if (!destCoords) {
          console.log(`[RoutePlanScheduler] Skipping store ${store.code}: collection point has no coordinates`);
          totalFailed++;
          continue;
        }

        // 执行路径规划
        const result = await planRoute(
          store.longitude!,
          store.latitude!,
          destCoords.longitude,
          destCoords.latitude,
          apiKey
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

        // 添加延迟避免超过QPS限制（高德免费 3 QPS，设置约 2 QPS）
        await new Promise(resolve => setTimeout(resolve, 500));
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

  console.log('[RoutePlanScheduler] Starting scheduler (check interval: 1min)...');
  
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
