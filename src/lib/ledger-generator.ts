import prisma from './db';
import { adjustToChineseTimezone } from './timezone';

interface GeneratorConfig {
  tireWeightKg: number;
  collectionTireLimit: number;
  collectionIntervalMin: number;
  collectionIntervalMax: number;
  coldStoreRatio: number;
  lossRatioMin: number;
  lossRatioMax: number;
  // 新增配置项
  minStopsPerTrip: number;       // 每趟最少停靠门店数
  maxStopsPerTrip: number;       // 每趟最多停靠门店数
  overloadRatio: number;         // 允许超载比例 (如 1.15 表示允许超载15%)
  overloadProbability: number;   // 超载概率 (0-1)
}

interface StoreInfo {
  id: string;
  code: string;
  name: string;
  estimatedTravelMinutes: number;
  longitude: number | null;
  latitude: number | null;
}

interface CollectionRecordData {
  recordNo: string;
  storeId: string;
  vehicleId: string;
  collectionDate: Date;
  loadingTime: Date;
  unloadingTime: Date | null;  // 只有最后一站才有卸车时间
  tireCount: number;
  loadingNetWeight: number;
  unloadingNetWeight: number;
  loss: number;
}

interface TimeSlot {
  departureTime: Date;
  arrivalTime: Date;
  returnTime: Date;
}

// 单次停靠信息
interface StopInfo {
  storeId: string;
  arrivalTime: Date;
  departureTime: Date;
  tireCount: number;
  weight: number;
}

// 多站点行程
interface MultiStopTrip {
  vehicleId: string;
  departureTime: Date;        // 从收集点出发时间
  returnTime: Date;           // 返回收集点时间
  stops: StopInfo[];          // 各门店停靠信息
  totalWeight: number;        // 总收集重量
  totalTireCount: number;     // 总轮胎数
}

// 收集点信息（包含坐标）
interface CollectionPointInfo {
  id: string;
  longitude: number | null;
  latitude: number | null;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 使用 Haversine 公式计算两点之间的距离（公里）
 */
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // 地球半径（公里）
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * 根据距离估算行驶时间（分钟）
 * 假设平均时速 30km/h（城市道路）
 */
function estimateTravelTime(distanceKm: number): number {
  const avgSpeedKmh = 30;
  return Math.ceil((distanceKm / avgSpeedKmh) * 60);
}

/**
 * LRU + 距离加权的门店选择器
 * 结合最近最少使用原则和地理距离，选择下一个要访问的门店
 */
class StoreSelector {
  private visitHistory: Map<string, number> = new Map(); // storeId -> 最后访问时间戳
  private visitCounter: number = 0;

  /**
   * 选择下一个要访问的门店
   * @param availableStores 可用门店列表
   * @param currentLat 当前位置纬度
   * @param currentLon 当前位置经度
   * @param excludeIds 本次行程已访问的门店ID（排除）
   * @param weightFactor 距离权重因子 (0-1)，越大越倾向于选择近的门店
   */
  selectNextStore(
    availableStores: StoreInfo[],
    currentLat: number | null,
    currentLon: number | null,
    excludeIds: Set<string>,
    weightFactor: number = 0.6
  ): StoreInfo | null {
    // 过滤掉本次行程已访问的门店
    const candidates = availableStores.filter((s) => !excludeIds.has(s.id));

    if (candidates.length === 0) {
      return null;
    }

    // 计算每个门店的得分
    const scored = candidates.map((store) => {
      // LRU 得分：越久没访问，得分越高
      const lastVisit = this.visitHistory.get(store.id) || 0;
      const lruScore = 1 - lastVisit / (this.visitCounter + 1);

      // 距离得分：越近，得分越高
      let distanceScore = 0.5; // 默认中等得分（无坐标时）
      if (
        currentLat !== null &&
        currentLon !== null &&
        store.latitude !== null &&
        store.longitude !== null
      ) {
        const distance = haversineDistance(
          currentLat,
          currentLon,
          store.latitude,
          store.longitude
        );
        // 距离转换为得分：0-50km 映射到 1-0
        distanceScore = Math.max(0, 1 - distance / 50);
      }

      // 综合得分 = 距离权重 * 距离得分 + (1-距离权重) * LRU得分
      // 再加一点随机因素 (±10%)
      const randomFactor = 0.9 + Math.random() * 0.2;
      const score =
        (weightFactor * distanceScore + (1 - weightFactor) * lruScore) *
        randomFactor;

      return { store, score };
    });

    // 按得分排序并选择（加入一些随机性，不总是选最高分的）
    scored.sort((a, b) => b.score - a.score);

    // 80% 概率选择得分最高的，20% 概率从前 3 名中随机选择
    let selectedIndex = 0;
    if (Math.random() > 0.8 && scored.length >= 3) {
      selectedIndex = Math.floor(Math.random() * 3);
    }

    return scored[selectedIndex]?.store || null;
  }

  /**
   * 记录门店访问
   */
  recordVisit(storeId: string): void {
    this.visitCounter++;
    this.visitHistory.set(storeId, this.visitCounter);
  }

  /**
   * 获取门店的 LRU 优先级（用于排序）
   * 返回值越大，表示越久没访问
   */
  getLruPriority(storeId: string): number {
    const lastVisit = this.visitHistory.get(storeId) || 0;
    return this.visitCounter - lastVisit;
  }
}

class VehicleScheduler {
  private schedules: Map<string, TimeSlot[]> = new Map();

  /**
   * 获取车辆最早可用时间
   * 考虑所有未完成的行程（包括跨天行程），确保新行程在上一趟完全结束后才开始
   */
  getEarliestAvailableTime(
    vehicleId: string,
    year: number,
    month: number,
    day: number,
    minStartHour: number
  ): Date {
    const slots = this.schedules.get(vehicleId) || [];
    const targetDayStart = new Date(year, month - 1, day, 0, 0, 0);
    const targetDayEnd = new Date(year, month - 1, day, 23, 59, 59);
    const defaultStartTime = new Date(year, month - 1, day, minStartHour, 0, 0);

    // 找出所有与当天有关的行程：
    // 1. 当天出发的行程
    // 2. 前一天出发但返回时间在当天的行程（跨天行程）
    const relevantSlots = slots.filter((slot) => {
      // 当天出发
      if (slot.departureTime >= targetDayStart && slot.departureTime <= targetDayEnd) {
        return true;
      }
      // 跨天：前一天出发，但返回时间延伸到当天
      if (slot.departureTime < targetDayStart && slot.returnTime > targetDayStart) {
        return true;
      }
      return false;
    });

    if (relevantSlots.length === 0) {
      return defaultStartTime;
    }

    // 找出最晚的返回时间
    const latestReturnTime = Math.max(...relevantSlots.map((s) => s.returnTime.getTime()));
    const latestReturn = new Date(latestReturnTime);

    // 如果最晚返回时间在工作开始时间之前，返回工作开始时间
    if (latestReturn < defaultStartTime) {
      return defaultStartTime;
    }

    return latestReturn;
  }

  /**
   * 检查新行程是否与已有行程冲突
   */
  hasConflict(
    vehicleId: string,
    departureTime: Date,
    returnTime: Date
  ): boolean {
    const slots = this.schedules.get(vehicleId) || [];

    for (const slot of slots) {
      // 检查时间重叠：
      // 1. 新行程的出发时间在已有行程进行中
      // 2. 新行程的返回时间在已有行程进行中
      // 3. 新行程完全包含已有行程
      // 4. 新行程在已有行程返回之前出发（关键检查）
      if (
        departureTime < slot.returnTime && returnTime > slot.departureTime
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * 预订行程
   */
  book(
    vehicleId: string,
    departureTime: Date,
    arrivalTime: Date,
    returnTime: Date
  ): void {
    if (!this.schedules.has(vehicleId)) {
      this.schedules.set(vehicleId, []);
    }
    this.schedules.get(vehicleId)!.push({ departureTime, arrivalTime, returnTime });
  }

  /**
   * 获取车辆当天的行程数
   */
  getTripCountForDay(
    vehicleId: string,
    year: number,
    month: number,
    day: number
  ): number {
    const slots = this.schedules.get(vehicleId) || [];
    const targetDateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return slots.filter(
      (slot) => formatLocalDate(slot.departureTime) === targetDateStr
    ).length;
  }
}

async function getConfig(): Promise<GeneratorConfig> {
  const configs = await prisma.systemConfig.findMany();
  const configMap = new Map(configs.map((c) => [c.key, c.value]));

  return {
    tireWeightKg: parseFloat(configMap.get('tire_weight_kg') || '10'),
    collectionTireLimit: parseInt(
      configMap.get('collection_tire_limit') || '200'
    ),
    // 收集间隔保持配置化：默认 7-15 天
    collectionIntervalMin: parseInt(
      configMap.get('collection_interval_min') ||
        configMap.get('collection_interval_days') ||
        '7'
    ),
    collectionIntervalMax: parseInt(
      configMap.get('collection_interval_max') || '15'
    ),
    // 降低冷门门店比例：从 10% 降为 5%，让更多门店参与收集
    coldStoreRatio: parseFloat(configMap.get('cold_store_ratio') || '0.05'),
    lossRatioMin: parseFloat(configMap.get('loss_ratio_min') || '0.001'),
    lossRatioMax: parseFloat(configMap.get('loss_ratio_max') || '0.005'),
    // 多站点配置
    minStopsPerTrip: parseInt(configMap.get('min_stops_per_trip') || '2'),
    maxStopsPerTrip: parseInt(configMap.get('max_stops_per_trip') || '5'),
    overloadRatio: parseFloat(configMap.get('overload_ratio') || '1.12'),
    overloadProbability: parseFloat(
      configMap.get('overload_probability') || '0.3'
    ),
  };
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloatBetween(
  min: number,
  max: number,
  decimals: number = 2
): number {
  const value = Math.random() * (max - min) + min;
  return parseFloat(value.toFixed(decimals));
}

function getDaysInRange(startDate: Date, endDate: Date): number {
  const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
}

function getDateFromRange(startDate: Date, dayOffset: number): Date {
  const date = new Date(startDate);
  date.setDate(date.getDate() + dayOffset);
  return date;
}

function generateRecordNo(prefix: string, index: number, date: Date): string {
  const dateStr = formatLocalDate(date).replace(/-/g, '');
  return `${prefix}-${dateStr}-${String(index).padStart(5, '0')}`;
}

/**
 * 生成多站点行程
 * 车辆从收集点出发，访问多个门店后返回
 * 
 * 超载控制逻辑：
 * 1. 在行程开始时确定本次行程的最大载重（允许超载时为 maxLoad * overloadRatio）
 * 2. 每站收集前检查剩余容量，确保不会导致沿途超载
 * 3. 如果剩余容量不足最小收集量，提前结束行程
 */
function generateMultiStopTrip(
  vehicle: { id: string; maxLoad: number },
  stores: StoreInfo[],
  collectionPoint: CollectionPointInfo,
  storeSelector: StoreSelector,
  config: GeneratorConfig,
  departureTime: Date,
  targetWeight: number
): MultiStopTrip | null {
  // 决定本次行程访问的门店数量
  const plannedStopsCount = randomBetween(config.minStopsPerTrip, config.maxStopsPerTrip);

  // 决定是否允许超载
  const allowOverload = Math.random() < config.overloadProbability;
  // 本次行程的硬性载重上限
  const maxLoadForTrip = allowOverload
    ? vehicle.maxLoad * config.overloadRatio
    : vehicle.maxLoad * randomFloatBetween(0.85, 0.98);

  // 实际目标重量（不超过最大载重）
  const actualTargetWeight = Math.min(targetWeight, maxLoadForTrip);

  // 最小收集量（低于此值不值得停靠）
  const minWeightPerStop = 200; // 最小 200kg

  const stops: StopInfo[] = [];
  const visitedIds = new Set<string>();
  let currentTime = new Date(departureTime);
  let currentLat = collectionPoint.latitude;
  let currentLon = collectionPoint.longitude;
  let accumulatedWeight = 0;
  let accumulatedTireCount = 0;

  for (let i = 0; i < plannedStopsCount; i++) {
    // ======== 沿途超载检查 ========
    // 计算当前剩余容量（基于硬性载重上限）
    const remainingCapacity = maxLoadForTrip - accumulatedWeight;
    
    // 如果剩余容量不足最小收集量，提前结束行程
    if (remainingCapacity < minWeightPerStop) {
      break;
    }

    // 选择下一个门店
    const store = storeSelector.selectNextStore(
      stores,
      currentLat,
      currentLon,
      visitedIds,
      0.6 // 距离权重
    );

    if (!store) {
      break; // 没有更多可用门店
    }

    // 计算到达时间
    let travelMinutes = store.estimatedTravelMinutes;
    if (
      currentLat !== null &&
      currentLon !== null &&
      store.latitude !== null &&
      store.longitude !== null
    ) {
      const distance = haversineDistance(
        currentLat,
        currentLon,
        store.latitude,
        store.longitude
      );
      travelMinutes = estimateTravelTime(distance);
    }

    // 添加随机波动
    const travelVariance = randomBetween(-3, 8);
    const actualTravelMinutes = Math.max(5, travelMinutes + travelVariance);

    const arrivalTime = new Date(
      currentTime.getTime() + actualTravelMinutes * 60 * 1000
    );

    // ======== 计算本站收集量（确保不超载） ========
    const remainingStops = plannedStopsCount - i;
    const remainingTargetWeight = actualTargetWeight - accumulatedWeight;
    
    // 根据剩余目标和剩余站点计算本站理想收集量
    let idealWeight: number;
    if (remainingStops === 1) {
      // 最后一站：尽量收集剩余目标量
      idealWeight = remainingTargetWeight;
    } else {
      // 中间站点：根据剩余站点数平均分配，并加入波动 (±30%)
      const avgRemainingWeight = remainingTargetWeight / remainingStops;
      idealWeight = avgRemainingWeight * randomFloatBetween(0.7, 1.3);
    }

    // 确保不超过剩余容量（硬性限制）
    let stopWeight = Math.min(idealWeight, remainingCapacity);
    
    // 确保最小收集量
    stopWeight = Math.max(minWeightPerStop, stopWeight);
    
    // 最终再次确保不超载
    stopWeight = Math.min(stopWeight, remainingCapacity);

    // 转换为轮胎数量
    const tireCount = Math.round(stopWeight / config.tireWeightKg);
    const actualTireCount = Math.max(20, tireCount); // 最少 20 条轮胎

    // 给轮胎重量添加随机波动（±5%，减小波动防止超载）
    const avgTireWeight = config.tireWeightKg * randomFloatBetween(0.95, 1.05);
    let actualWeight = parseFloat((actualTireCount * avgTireWeight).toFixed(2));
    
    // 最终超载保护：确保累积重量不超过上限
    if (accumulatedWeight + actualWeight > maxLoadForTrip) {
      actualWeight = parseFloat((maxLoadForTrip - accumulatedWeight).toFixed(2));
      // 如果调整后的重量太小，跳过这一站
      if (actualWeight < minWeightPerStop) {
        break;
      }
    }

    // 装卸时间：根据轮胎数量计算，基础 8 分钟 + 每 20 条轮胎 1 分钟
    const loadingMinutes = 8 + Math.ceil(actualTireCount / 20);
    const departureTimeFromStop = new Date(
      arrivalTime.getTime() + loadingMinutes * 60 * 1000
    );

    stops.push({
      storeId: store.id,
      arrivalTime,
      departureTime: departureTimeFromStop,
      tireCount: actualTireCount,
      weight: actualWeight,
    });

    // 更新状态
    visitedIds.add(store.id);
    storeSelector.recordVisit(store.id);
    currentTime = departureTimeFromStop;
    currentLat = store.latitude;
    currentLon = store.longitude;
    accumulatedWeight += actualWeight;
    accumulatedTireCount += actualTireCount;

    // 如果已经达到目标重量的 95%，可以提前结束
    if (accumulatedWeight >= actualTargetWeight * 0.95) {
      break;
    }
  }

  // 如果没有任何停靠，返回 null
  if (stops.length === 0) {
    return null;
  }

  // 计算返回收集点的时间
  const lastStop = stops[stops.length - 1];
  let returnTravelMinutes = 30; // 默认 30 分钟
  const lastStore = stores.find((s) => s.id === lastStop.storeId);

  if (lastStore) {
    if (
      collectionPoint.latitude !== null &&
      collectionPoint.longitude !== null &&
      lastStore.latitude !== null &&
      lastStore.longitude !== null
    ) {
      const returnDistance = haversineDistance(
        lastStore.latitude,
        lastStore.longitude,
        collectionPoint.latitude,
        collectionPoint.longitude
      );
      returnTravelMinutes = estimateTravelTime(returnDistance);
    } else {
      returnTravelMinutes = lastStore.estimatedTravelMinutes;
    }
  }

  // 添加返程时间波动和卸货休息时间
  const returnVariance = randomBetween(-3, 10);
  const actualReturnMinutes = Math.max(10, returnTravelMinutes + returnVariance);
  const unloadAndRestMinutes = randomBetween(15, 30); // 卸货 + 休息

  const returnTime = new Date(
    lastStop.departureTime.getTime() +
      (actualReturnMinutes + unloadAndRestMinutes) * 60 * 1000
  );

  return {
    vehicleId: vehicle.id,
    departureTime,
    returnTime,
    stops,
    totalWeight: accumulatedWeight,
    totalTireCount: accumulatedTireCount,
  };
}

/**
 * 分配车辆并生成多站点行程
 */
function assignVehicleAndGenerateTrip(
  vehicles: Array<{ id: string; plateNumber: string; maxLoad: number }>,
  scheduler: VehicleScheduler,
  stores: StoreInfo[],
  collectionPoint: CollectionPointInfo,
  storeSelector: StoreSelector,
  config: GeneratorConfig,
  year: number,
  month: number,
  day: number,
  targetWeight: number
): MultiStopTrip | null {
  // 司机工作时间：8:00-18:00
  const startHour = 8;
  const endHour = 18;

  // 按当天行程数排序，优先分配给任务少的车辆
  const sortedVehicles = [...vehicles].sort((a, b) => {
    const countA = scheduler.getTripCountForDay(a.id, year, month, day);
    const countB = scheduler.getTripCountForDay(b.id, year, month, day);
    return countA - countB;
  });

  for (const vehicle of sortedVehicles) {
    // 每辆车每天最多 8 趟（多站点行程时间更长）
    if (scheduler.getTripCountForDay(vehicle.id, year, month, day) >= 8) {
      continue;
    }

    const earliestTime = scheduler.getEarliestAvailableTime(
      vehicle.id,
      year,
      month,
      day,
      startHour
    );

    if (earliestTime.getHours() >= endHour) {
      continue;
    }

    // 在上一趟结束后，预留 5-15 分钟的缓冲时间（卸货后休息、准备下一趟）
    const bufferMinutes = randomBetween(5, 15);
    const randomOffset = bufferMinutes * 60 * 1000;
    const departureTime = new Date(earliestTime.getTime() + randomOffset);

    if (departureTime.getHours() >= endHour - 1) {
      // 留出至少 1 小时完成行程
      continue;
    }

    // 生成多站点行程
    const trip = generateMultiStopTrip(
      vehicle,
      stores,
      collectionPoint,
      storeSelector,
      config,
      departureTime,
      targetWeight
    );

    if (!trip) {
      continue;
    }

    // 检查返回时间是否在工作时间内（允许略微超时）
    const returnHour = trip.returnTime.getHours();
    if (returnHour > endHour + 1) {
      // 允许最多超时 1 小时
      continue;
    }

    // 检查时间冲突
    if (scheduler.hasConflict(vehicle.id, trip.departureTime, trip.returnTime)) {
      continue;
    }

    return trip;
  }

  return null;
}

/**
 * 生成收集台账数据（不包含转移记录）
 * @param taskId 任务ID
 * @param collectionPointId 收集点ID
 * @param startDate 开始日期
 * @param endDate 结束日期
 * @param targetTonnage 目标吨数
 */
export async function generateLedgerData(
  taskId: string,
  collectionPointId: string,
  startDate: Date,
  endDate: Date,
  targetTonnage: number
): Promise<{ collectionRecords: CollectionRecordData[] }> {
  const config = await getConfig();
  const totalDays = getDaysInRange(startDate, endDate);

  const [allStores, collectionVehicles, collectionPoint] = await Promise.all([
    prisma.store.findMany({
      where: { collectionPointId, status: 'ACTIVE' },
      select: {
        id: true,
        code: true,
        name: true,
        estimatedTravelMinutes: true,
        longitude: true,
        latitude: true,
      },
    }),
    prisma.vehicle.findMany({
      where: { collectionPointId, type: 'COLLECTION', status: 'ACTIVE' },
      select: { id: true, plateNumber: true, maxLoad: true },
    }),
    prisma.collectionPoint.findUnique({
      where: { id: collectionPointId },
      select: { id: true, longitude: true, latitude: true },
    }),
  ]);

  if (!collectionPoint) {
    throw new Error('收集点不存在');
  }

  // 过滤掉预估时间为 0 或没有预估时间的门店
  const stores: StoreInfo[] = allStores.filter(
    (store) => store.estimatedTravelMinutes && store.estimatedTravelMinutes > 0
  );

  if (stores.length === 0) {
    throw new Error('该收集点没有可用的门店（所有门店预估时间为空或为0）');
  }
  if (collectionVehicles.length === 0) {
    throw new Error('该收集点没有可用的收集车辆');
  }

  const collectionRecords: CollectionRecordData[] = [];
  const scheduler = new VehicleScheduler();
  const storeSelector = new StoreSelector();

  // 获取收集车辆的平均载重
  const avgVehicleLoad =
    collectionVehicles.reduce((sum, v) => sum + v.maxLoad, 0) /
    collectionVehicles.length;

  // 计算需要的总行程数（考虑每次平均载重 70%）
  const avgWeightPerTrip = avgVehicleLoad * 0.7;
  const totalTripsNeeded = Math.ceil(targetTonnage / avgWeightPerTrip);

  // 每天需要的行程数
  const baseTripsPerDay = Math.floor(totalTripsNeeded / totalDays);
  const extraTrips = totalTripsNeeded % totalDays;

  let collectionIndex = 0;
  let accumulatedWeight = 0;

  // 为每一天生成行程
  for (let dayOffset = 0; dayOffset < totalDays; dayOffset++) {
    const targetDate = getDateFromRange(startDate, dayOffset);
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth() + 1;
    const day = targetDate.getDate();
    const collectionDate = new Date(year, month - 1, day);

    // 这一天需要的行程数量
    const tripsForDay = baseTripsPerDay + (dayOffset < extraTrips ? 1 : 0);
    const maxTripsPerDay = collectionVehicles.length * 8;
    const actualTripsForDay = Math.min(tripsForDay, maxTripsPerDay);

    // 为这一天生成行程
    for (let tripIndex = 0; tripIndex < actualTripsForDay; tripIndex++) {
      // 检查是否已经达到目标
      if (accumulatedWeight >= targetTonnage * 0.99) {
        break;
      }

      // 计算剩余目标和本次行程目标重量
      const remainingTarget = targetTonnage - accumulatedWeight;
      const remainingDays = totalDays - dayOffset;
      const remainingTripsEstimate =
        remainingDays * (actualTripsForDay / (tripIndex + 1));

      // 本次行程目标重量
      let tripTargetWeight = remainingTarget / Math.max(1, remainingTripsEstimate);
      tripTargetWeight = Math.max(
        avgVehicleLoad * 0.5,
        Math.min(tripTargetWeight * randomFloatBetween(0.9, 1.1), avgVehicleLoad)
      );

      // 分配车辆并生成多站点行程
      const trip = assignVehicleAndGenerateTrip(
        collectionVehicles,
        scheduler,
        stores,
        collectionPoint,
        storeSelector,
        config,
        year,
        month,
        day,
        tripTargetWeight
      );

      if (!trip) {
        continue;
      }

      // 记录行程到调度器
      scheduler.book(
        trip.vehicleId,
        trip.departureTime,
        trip.stops[0].arrivalTime,
        trip.returnTime
      );

      // 为每个停靠点创建收集记录
      // 注意：卸车只发生在返回收集点时，只有最后一站才有 unloadingTime
      for (let stopIndex = 0; stopIndex < trip.stops.length; stopIndex++) {
        const stop = trip.stops[stopIndex];
        const isLastStop = stopIndex === trip.stops.length - 1;

        // 生成折损（折损发生在运输过程中，在卸车时体现）
        const lossRatio = randomFloatBetween(
          config.lossRatioMin,
          config.lossRatioMax,
          5
        );
        const loss = parseFloat((stop.weight * lossRatio).toFixed(2));
        const unloadingNetWeight = parseFloat((stop.weight - loss).toFixed(2));

        collectionRecords.push({
          recordNo: generateRecordNo('CR', ++collectionIndex, collectionDate),
          storeId: stop.storeId,
          vehicleId: trip.vehicleId,
          collectionDate,
          loadingTime: stop.arrivalTime,                        // 装车时间：到达门店的时间
          unloadingTime: isLastStop ? trip.returnTime : null,   // 卸车时间：只有最后一站才有
          tireCount: stop.tireCount,
          loadingNetWeight: stop.weight,
          unloadingNetWeight,
          loss,
        });

        accumulatedWeight += stop.weight;
      }
    }

    // 如果已经达到目标，提前结束
    if (accumulatedWeight >= targetTonnage * 0.99) {
      break;
    }
  }

  return { collectionRecords };
}

export interface LedgerGenerationResult {
  totalRecords: number;
  totalLoadingWeight: number;
  totalUnloadingWeight: number;
  totalLoss: number;
  storesCount: number;
  vehiclesCount: number;
}

/**
 * 执行收集台账生成任务（同步执行）
 * @returns 生成结果统计
 */
export async function executeLedgerTask(
  taskId: string
): Promise<LedgerGenerationResult> {
  const task = await prisma.ledgerTask.findUnique({
    where: { id: taskId },
  });

  if (!task) {
    throw new Error('任务不存在');
  }

  try {
    await prisma.ledgerTask.update({
      where: { id: taskId },
      data: { status: 'PROCESSING', startedAt: new Date() },
    });

    await prisma.collectionRecord.deleteMany({ where: { taskId } });

    // targetTonnage 字段实际存储的是 kg 值
    const { collectionRecords } = await generateLedgerData(
      taskId,
      task.collectionPointId,
      task.startDate,
      task.endDate,
      task.targetTonnage // 单位: kg
    );

    // 在保存前调整时间为中国时区
    await prisma.collectionRecord.createMany({
      data: collectionRecords.map((r) => {
        const { unloadingTime, ...rest } = r;
        return {
          ...rest,
          taskId,
          collectionDate: adjustToChineseTimezone(r.collectionDate),
          loadingTime: adjustToChineseTimezone(r.loadingTime),
          // unloadingTime 只有最后一站才有
          ...(unloadingTime && { unloadingTime: adjustToChineseTimezone(unloadingTime) }),
        };
      }),
    });

    // 所有重量单位为 kg
    const totalLoadingWeight = collectionRecords.reduce(
      (sum, r) => sum + r.loadingNetWeight,
      0
    );
    const totalUnloadingWeight = collectionRecords.reduce(
      (sum, r) => sum + r.unloadingNetWeight,
      0
    );
    const totalLoss = collectionRecords.reduce((sum, r) => sum + r.loss, 0);
    const storesCount = new Set(collectionRecords.map((r) => r.storeId)).size;
    const vehiclesCount = new Set(collectionRecords.map((r) => r.vehicleId)).size;

    await prisma.ledgerTask.update({
      where: { id: taskId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        actualTonnage: parseFloat(totalLoadingWeight.toFixed(2)),
        unloadingTonnage: parseFloat(totalUnloadingWeight.toFixed(2)),
        totalLoss: parseFloat(totalLoss.toFixed(2)),
      },
    });

    return {
      totalRecords: collectionRecords.length,
      totalLoadingWeight: parseFloat(totalLoadingWeight.toFixed(2)),
      totalUnloadingWeight: parseFloat(totalUnloadingWeight.toFixed(2)),
      totalLoss: parseFloat(totalLoss.toFixed(2)),
      storesCount,
      vehiclesCount,
    };
  } catch (error) {
    await prisma.ledgerTask.update({
      where: { id: taskId },
      data: {
        status: 'FAILED',
        errorMessage: error instanceof Error ? error.message : '未知错误',
      },
    });
    throw error;
  }
}
