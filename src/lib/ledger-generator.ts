import prisma from "./db";
import { adjustToChineseTimezone } from "./timezone";

interface GeneratorConfig {
  tireWeightKg: number;
  collectionTireLimit: number;
  collectionIntervalMin: number;
  collectionIntervalMax: number;
  coldStoreRatio: number;
  lossRatioMin: number;
  lossRatioMax: number;
  // 新增配置项
  minStopsPerTrip: number; // 每趟最少停靠门店数
  maxStopsPerTrip: number; // 每趟最多停靠门店数
  overloadRatio: number; // 允许超载比例 (如 1.15 表示允许超载15%)
  overloadProbability: number; // 超载概率 (0-1)
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
  unloadingTime: Date | null; // 只有最后一站才有卸车时间
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
  departureTime: Date; // 从收集点出发时间
  returnTime: Date; // 返回收集点时间
  stops: StopInfo[]; // 各门店停靠信息
  totalWeight: number; // 总收集重量
  totalTireCount: number; // 总轮胎数
}

// 收集点信息（包含坐标）
interface CollectionPointInfo {
  id: string;
  longitude: number | null;
  latitude: number | null;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
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
 *
 * 访问历史是全局的：
 * - 门店访问后，需间隔随机天数（minInterval ~ maxInterval）才能再次访问
 * - 访问历史基于日期，越久没访问的门店优先级越高
 */
class StoreSelector {
  // storeId -> 下次可访问日期（格式：YYYY-MM-DD）
  private nextAvailableDate: Map<string, string> = new Map();
  // storeId -> 上次访问日期（用于计算 LRU 得分）
  private lastVisitDate: Map<string, string> = new Map();
  // 访问间隔范围
  private minIntervalDays: number;
  private maxIntervalDays: number;

  constructor(minIntervalDays: number, maxIntervalDays: number) {
    this.minIntervalDays = minIntervalDays;
    this.maxIntervalDays = maxIntervalDays;
  }

  /**
   * 获取日期字符串
   */
  private getDateStr(date: Date): string {
    return formatLocalDate(date);
  }

  /**
   * 计算两个日期之间的天数差（date2 - date1）
   * 返回正数表示 date2 在 date1 之后
   */
  private daysBetween(date1: string, date2: string): number {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    const diffTime = d2.getTime() - d1.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  /**
   * 添加天数到日期
   */
  private addDays(dateStr: string, days: number): string {
    const date = new Date(dateStr);
    date.setDate(date.getDate() + days);
    return formatLocalDate(date);
  }

  /**
   * 检查门店是否在冷却期内（不可访问）
   * 如果当前日期早于下次可访问日期，返回 true（不可访问）
   */
  isInCooldown(storeId: string, currentDate: Date): boolean {
    const nextAvailable = this.nextAvailableDate.get(storeId);
    if (!nextAvailable) {
      return false; // 从未访问过，可以访问
    }
    const currentDateStr = this.getDateStr(currentDate);
    // 如果当前日期 < 下次可访问日期，则在冷却期内
    return this.daysBetween(nextAvailable, currentDateStr) < 0;
  }

  /**
   * 获取门店距离上次访问的天数（用于 LRU 计算）
   */
  getDaysSinceLastVisit(storeId: string, currentDate: Date): number {
    const lastVisit = this.lastVisitDate.get(storeId);
    if (!lastVisit) {
      return 999; // 从未访问过，返回很大的值
    }
    const currentDateStr = this.getDateStr(currentDate);
    return Math.max(0, this.daysBetween(lastVisit, currentDateStr));
  }

  /**
   * 选择下一个要访问的门店
   * @param availableStores 可用门店列表
   * @param currentLat 当前位置纬度
   * @param currentLon 当前位置经度
   * @param excludeIds 本次行程已访问的门店ID（排除）
   * @param currentDate 当前日期
   * @param isFirstStop 是否为第一个停靠点（第一个停靠点优先考虑访问历史）
   */
  selectNextStore(
    availableStores: StoreInfo[],
    currentLat: number | null,
    currentLon: number | null,
    excludeIds: Set<string>,
    currentDate: Date,
    isFirstStop: boolean = false
  ): StoreInfo | null {
    // 过滤掉：1) 本次行程已访问的门店  2) 在冷却期内的门店
    const candidates = availableStores.filter((s) => {
      if (excludeIds.has(s.id)) return false;
      if (this.isInCooldown(s.id, currentDate)) return false;
      return true;
    });

    if (candidates.length === 0) {
      return null;
    }

    // 第一个停靠点策略：在距离合理的门店中，优先选择最久未访问的
    // 这样既保证门店访问均匀性，又不会因为路程过远降低效率
    if (isFirstStop && currentLat !== null && currentLon !== null) {
      const MAX_FIRST_STOP_DISTANCE_KM = 25; // 第一站最大距离限制

      // 计算所有候选门店的距离
      const candidatesWithDistance = candidates
        .map((store) => {
          let distance = Infinity;
          if (store.latitude !== null && store.longitude !== null) {
            distance = haversineDistance(
              currentLat,
              currentLon,
              store.latitude,
              store.longitude
            );
          }
          return { store, distance };
        })
        .filter((c) => c.distance <= MAX_FIRST_STOP_DISTANCE_KM);

      // 如果有距离合理的门店，在其中按 LRU 优先选择
      if (candidatesWithDistance.length > 0) {
        // 按 LRU 优先级排序（越久没访问越优先）
        const sortedByLru = candidatesWithDistance
          .map((c) => {
            const lruPriority = this.getDaysSinceLastVisit(
              c.store.id,
              currentDate
            );
            return { ...c, lruPriority };
          })
          .sort((a, b) => b.lruPriority - a.lruPriority);

        // 在 LRU 优先级最高的前 5 个中随机选择（加入随机性）
        const topCandidates = sortedByLru.slice(0, 5);
        const selectedIndex = Math.floor(Math.random() * topCandidates.length);
        return topCandidates[selectedIndex].store;
      }
      // 如果没有距离合理的门店，继续使用常规策略
    }

    // 常规策略：综合考虑距离和 LRU
    // - 后续停靠点：0.7（70% 权重给距离，优先选择近的门店以优化路线）
    const distanceWeight = 0.7;

    // 计算每个门店的得分
    const scored = candidates.map((store) => {
      // LRU 得分：越久没访问，得分越高
      // 假设 30 天以上没访问就满分
      const daysSinceVisit = this.getDaysSinceLastVisit(store.id, currentDate);
      const lruScore = Math.min(1.0, daysSinceVisit / 30);

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
        (distanceWeight * distanceScore + (1 - distanceWeight) * lruScore) *
        randomFactor;

      return { store, score, lruScore, distanceScore };
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
   * 记录门店访问（全局记录）
   * 同时生成随机冷却期（在 minInterval 和 maxInterval 之间）
   * @param storeId 门店ID
   * @param visitDate 访问日期
   */
  recordVisit(storeId: string, visitDate: Date): void {
    const dateStr = this.getDateStr(visitDate);

    // 记录上次访问日期（用于 LRU 计算）
    this.lastVisitDate.set(storeId, dateStr);

    // 随机生成冷却天数（在 min 和 max 之间）
    const cooldownDays = randomBetween(
      this.minIntervalDays,
      this.maxIntervalDays
    );

    // 计算下次可访问日期
    const nextAvailable = this.addDays(dateStr, cooldownDays);
    this.nextAvailableDate.set(storeId, nextAvailable);
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
      if (
        slot.departureTime >= targetDayStart &&
        slot.departureTime <= targetDayEnd
      ) {
        return true;
      }
      // 跨天：前一天出发，但返回时间延伸到当天
      if (
        slot.departureTime < targetDayStart &&
        slot.returnTime > targetDayStart
      ) {
        return true;
      }
      return false;
    });

    if (relevantSlots.length === 0) {
      return defaultStartTime;
    }

    // 找出最晚的返回时间
    const latestReturnTime = Math.max(
      ...relevantSlots.map((s) => s.returnTime.getTime())
    );
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
      if (departureTime < slot.returnTime && returnTime > slot.departureTime) {
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
    this.schedules
      .get(vehicleId)!
      .push({ departureTime, arrivalTime, returnTime });
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
    const targetDateStr = `${year}-${String(month).padStart(2, "0")}-${String(
      day
    ).padStart(2, "0")}`;
    return slots.filter(
      (slot) => formatLocalDate(slot.departureTime) === targetDateStr
    ).length;
  }
}

async function getConfig(): Promise<GeneratorConfig> {
  const configs = await prisma.systemConfig.findMany();
  const configMap = new Map(configs.map((c) => [c.key, c.value]));

  return {
    tireWeightKg: parseFloat(configMap.get("tire_weight_kg") || "10"),
    collectionTireLimit: parseInt(
      configMap.get("collection_tire_limit") || "200"
    ),
    // 收集间隔保持配置化：默认 7-15 天
    collectionIntervalMin: parseInt(
      configMap.get("collection_interval_min") ||
        configMap.get("collection_interval_days") ||
        "7"
    ),
    collectionIntervalMax: parseInt(
      configMap.get("collection_interval_max") || "15"
    ),
    // 降低冷门门店比例：从 10% 降为 5%，让更多门店参与收集
    coldStoreRatio: parseFloat(configMap.get("cold_store_ratio") || "0.05"),
    lossRatioMin: parseFloat(configMap.get("loss_ratio_min") || "0.001"),
    lossRatioMax: parseFloat(configMap.get("loss_ratio_max") || "0.005"),
    // 多站点配置
    minStopsPerTrip: parseInt(configMap.get("min_stops_per_trip") || "2"),
    maxStopsPerTrip: parseInt(configMap.get("max_stops_per_trip") || "5"),
    overloadRatio: parseFloat(configMap.get("overload_ratio") || "3.5"),
    overloadProbability: parseFloat(
      configMap.get("overload_probability") || "0.5"
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

/**
 * 将重量四舍五入到最近的 10kg（模拟磅秤精度）
 */
function roundToNearest10(value: number): number {
  return Math.round(value / 10) * 10;
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
  const dateStr = formatLocalDate(date).replace(/-/g, "");
  return `${prefix}-${dateStr}-${String(index).padStart(5, "0")}`;
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
  vehicle: { id: string; maxLoad: number; tareWeight: number },
  stores: StoreInfo[],
  collectionPoint: CollectionPointInfo,
  storeSelector: StoreSelector,
  config: GeneratorConfig,
  departureTime: Date,
  targetWeight: number,
  collectionDate: Date
): MultiStopTrip | null {
  // 决定本次行程访问的门店数量
  const plannedStopsCount = randomBetween(
    config.minStopsPerTrip,
    config.maxStopsPerTrip
  );

  // 决定是否允许超载
  const allowOverload = Math.random() < config.overloadProbability;
  // 净重上限
  const netWeightLimit = vehicle.maxLoad - vehicle.tareWeight;
  // 本次行程的硬性载重上限
  const maxLoadForTrip = allowOverload
    ? netWeightLimit * config.overloadRatio
    : netWeightLimit * randomFloatBetween(0.85, 0.98);

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
    // 第一个停靠点优先考虑访问历史，后续停靠点综合考虑距离
    const isFirstStop = i === 0;
    const store = storeSelector.selectNextStore(
      stores,
      currentLat,
      currentLon,
      visitedIds,
      collectionDate,
      isFirstStop
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
    // 四舍五入到 10kg（模拟磅秤精度）
    let actualWeight = roundToNearest10(actualTireCount * avgTireWeight);

    // 最终超载保护：确保累积重量不超过上限
    if (accumulatedWeight + actualWeight > maxLoadForTrip) {
      actualWeight = roundToNearest10(maxLoadForTrip - accumulatedWeight);
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
    storeSelector.recordVisit(store.id, collectionDate);
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
  const actualReturnMinutes = Math.max(
    10,
    returnTravelMinutes + returnVariance
  );
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
  vehicles: Array<{
    id: string;
    plateNumber: string;
    maxLoad: number;
    tareWeight: number;
  }>,
  scheduler: VehicleScheduler,
  stores: StoreInfo[],
  collectionPoint: CollectionPointInfo,
  storeSelector: StoreSelector,
  config: GeneratorConfig,
  year: number,
  month: number,
  day: number,
  targetWeight: number,
  collectionDate: Date,
  maxTripsPerVehiclePerDay: number = 2
): MultiStopTrip | null {
  // 司机工作时间：6:00-20:00
  const startHour = 6;
  const endHour = 20;

  // 按当天行程数排序，优先分配给任务少的车辆
  const sortedVehicles = [...vehicles].sort((a, b) => {
    const countA = scheduler.getTripCountForDay(a.id, year, month, day);
    const countB = scheduler.getTripCountForDay(b.id, year, month, day);
    return countA - countB;
  });

  for (const vehicle of sortedVehicles) {
    // 每辆车每天最多 maxTripsPerVehiclePerDay 趟（从出发到卸车算一趟）
    if (scheduler.getTripCountForDay(vehicle.id, year, month, day) >= maxTripsPerVehiclePerDay) {
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
      targetWeight,
      collectionDate
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
    if (
      scheduler.hasConflict(vehicle.id, trip.departureTime, trip.returnTime)
    ) {
      continue;
    }

    return trip;
  }

  return null;
}

/**
 * 检测并重新分配最后几天空缺的数据
 * 如果最后几天没有数据，取出空缺天数*2的行程，重新分配到空缺的天数中
 * 保持门店和重量不变，但重新生成时间
 * 按行程（趟）平均分配到各天，而不是按记录条数
 */
function redistributeRecordsToEmptyDays(
  records: CollectionRecordData[],
  startDate: Date,
  endDate: Date,
  vehicles: Array<{
    id: string;
    plateNumber: string;
    maxLoad: number;
    tareWeight: number;
  }>,
  stores: StoreInfo[],
  collectionPoint: CollectionPointInfo
): CollectionRecordData[] {
  if (records.length === 0) {
    return records;
  }

  const totalDays = getDaysInRange(startDate, endDate);

  // 统计每天的记录数
  const recordsByDate = new Map<string, CollectionRecordData[]>();
  for (let dayOffset = 0; dayOffset < totalDays; dayOffset++) {
    const date = getDateFromRange(startDate, dayOffset);
    const dateStr = formatLocalDate(date);
    recordsByDate.set(dateStr, []);
  }

  for (const record of records) {
    const dateStr = formatLocalDate(record.collectionDate);
    const existing = recordsByDate.get(dateStr);
    if (existing) {
      existing.push(record);
    }
  }

  // 找出最后连续没有数据的天数
  let emptyDaysAtEnd = 0;
  for (let dayOffset = totalDays - 1; dayOffset >= 0; dayOffset--) {
    const date = getDateFromRange(startDate, dayOffset);
    const dateStr = formatLocalDate(date);
    const dayRecords = recordsByDate.get(dateStr) || [];
    if (dayRecords.length === 0) {
      emptyDaysAtEnd++;
    } else {
      break; // 遇到有数据的天就停止
    }
  }

  console.log(`最后 ${emptyDaysAtEnd} 天没有数据`);

  // 如果没有空缺天数，直接返回原记录
  if (emptyDaysAtEnd === 0) {
    return records;
  }

  console.log(`检测到最后 ${emptyDaysAtEnd} 天没有数据，开始重新分配...`);

  // 计算需要重新分配的天数 = 空缺天数 × 2
  const daysToFill = Math.min(emptyDaysAtEnd * 2, totalDays);
  // 从倒数第 daysToFill 天开始填充
  const fillStartDayOffset = totalDays - daysToFill;

  // 收集需要重新分配的天数内的所有记录
  // 从有数据的最后 (空缺天数 × 2 - 空缺天数) 天取数据
  const daysWithDataToMove = daysToFill - emptyDaysAtEnd;
  const recordsToMoveStartOffset = fillStartDayOffset;

  // 收集需要重新分配的记录（从 fillStartDayOffset 开始的 daysWithDataToMove 天的数据）
  const recordsToMove: CollectionRecordData[] = [];
  const recordsToKeep: CollectionRecordData[] = [];

  for (const record of records) {
    const recordDateStr = formatLocalDate(record.collectionDate);
    const recordDayOffset = Array.from(recordsByDate.keys()).indexOf(
      recordDateStr
    );

    if (
      recordDayOffset >= recordsToMoveStartOffset &&
      recordDayOffset < recordsToMoveStartOffset + daysWithDataToMove
    ) {
      // 这条记录在需要重新分配的天数范围内
      recordsToMove.push(record);
    } else {
      recordsToKeep.push(record);
    }
  }

  console.log(
    `从 ${daysWithDataToMove} 天中取出 ${recordsToMove.length} 条记录进行重新分配`
  );

  if (recordsToMove.length === 0) {
    return records;
  }

  // 将需要重新分配的记录按行程分组（通过检测 unloadingTime 来判断行程边界）
  // 每个行程的最后一条记录有 unloadingTime
  const tripsToMove: CollectionRecordData[][] = [];
  let currentTrip: CollectionRecordData[] = [];

  for (const record of recordsToMove) {
    currentTrip.push(record);
    if (record.unloadingTime !== null) {
      // 行程结束
      tripsToMove.push(currentTrip);
      currentTrip = [];
    }
  }
  // 如果还有未完成的行程，也加入
  if (currentTrip.length > 0) {
    tripsToMove.push(currentTrip);
  }

  console.log(
    `分析出 ${tripsToMove.length} 趟行程需要重新分配到 ${daysToFill} 天`
  );

  if (tripsToMove.length === 0) {
    return records;
  }

  // 为需要重新分配的行程重新生成时间
  const redistributedRecords: CollectionRecordData[] = [];
  const scheduler = new VehicleScheduler();

  // 计算每天应该分配的行程数（尽量均匀）
  const baseTripsPerDay = Math.floor(tripsToMove.length / daysToFill);
  const extraTrips = tripsToMove.length % daysToFill;

  console.log(`每天基础 ${baseTripsPerDay} 趟，前 ${extraTrips} 天各多 1 趟`);

  let tripIndex = 0;
  for (
    let fillDay = 0;
    fillDay < daysToFill && tripIndex < tripsToMove.length;
    fillDay++
  ) {
    const targetDayOffset = fillStartDayOffset + fillDay;
    const targetDate = getDateFromRange(startDate, targetDayOffset);
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth() + 1;
    const day = targetDate.getDate();
    const collectionDate = new Date(year, month - 1, day);

    // 这一天需要处理的行程数（前 extraTrips 天多分配 1 趟）
    const tripsForThisDay = baseTripsPerDay + (fillDay < extraTrips ? 1 : 0);

    // 处理这一天的行程
    const tripsForDay: CollectionRecordData[][] = [];
    for (
      let i = 0;
      i < tripsForThisDay && tripIndex < tripsToMove.length;
      i++
    ) {
      tripsForDay.push(tripsToMove[tripIndex]);
      tripIndex++;
    }

    // 为每个行程重新生成时间
    const startHour = 6;
    const endHour = 20;

    for (const tripRecords of tripsForDay) {
      if (tripRecords.length === 0) continue;

      // 找一辆可用的车辆
      const vehicleId = tripRecords[0].vehicleId;
      const vehicle = vehicles.find((v) => v.id === vehicleId) || vehicles[0];

      // 获取车辆最早可用时间
      let departureTime = scheduler.getEarliestAvailableTime(
        vehicle.id,
        year,
        month,
        day,
        startHour
      );

      // 添加一些随机缓冲时间
      const bufferMinutes = randomBetween(5, 15);
      departureTime = new Date(
        departureTime.getTime() + bufferMinutes * 60 * 1000
      );

      // 如果已经超过工作时间，跳到下一天的开始
      if (departureTime.getHours() >= endHour - 1) {
        continue;
      }

      let currentTime = new Date(departureTime);
      let currentLat = collectionPoint.latitude;
      let currentLon = collectionPoint.longitude;

      // 为行程中的每条记录重新生成时间
      for (let stopIndex = 0; stopIndex < tripRecords.length; stopIndex++) {
        const originalRecord = tripRecords[stopIndex];
        const isLastStop = stopIndex === tripRecords.length - 1;

        // 获取门店信息
        const store = stores.find((s) => s.id === originalRecord.storeId);
        if (!store) continue;

        // 计算行驶时间
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

        // 装卸时间
        const loadingMinutes = 8 + Math.ceil(originalRecord.tireCount / 20);
        const departureTimeFromStop = new Date(
          arrivalTime.getTime() + loadingMinutes * 60 * 1000
        );

        // 计算返回时间（只有最后一站需要）
        let unloadingTime: Date | null = null;
        if (isLastStop) {
          let returnTravelMinutes = store.estimatedTravelMinutes;
          if (
            collectionPoint.latitude !== null &&
            collectionPoint.longitude !== null &&
            store.latitude !== null &&
            store.longitude !== null
          ) {
            const returnDistance = haversineDistance(
              store.latitude,
              store.longitude,
              collectionPoint.latitude,
              collectionPoint.longitude
            );
            returnTravelMinutes = estimateTravelTime(returnDistance);
          }
          const returnVariance = randomBetween(-3, 10);
          const actualReturnMinutes = Math.max(
            10,
            returnTravelMinutes + returnVariance
          );
          const unloadAndRestMinutes = randomBetween(15, 30);
          unloadingTime = new Date(
            departureTimeFromStop.getTime() +
              (actualReturnMinutes + unloadAndRestMinutes) * 60 * 1000
          );
        }

        // 创建新记录，保持门店和重量，更新时间
        redistributedRecords.push({
          ...originalRecord,
          collectionDate,
          loadingTime: arrivalTime,
          unloadingTime,
        });

        // 更新当前位置和时间
        currentTime = departureTimeFromStop;
        currentLat = store.latitude;
        currentLon = store.longitude;
      }

      // 记录行程到调度器
      if (tripRecords.length > 0) {
        const lastRecord =
          redistributedRecords[redistributedRecords.length - 1];
        const firstRecordOfTrip =
          redistributedRecords[
            redistributedRecords.length - tripRecords.length
          ];
        scheduler.book(
          vehicle.id,
          departureTime,
          firstRecordOfTrip.loadingTime,
          lastRecord.unloadingTime || lastRecord.loadingTime
        );
      }
    }
  }

  // 重新生成记录编号（按日期和顺序）
  const allRecords = [...recordsToKeep, ...redistributedRecords];

  // 按收集日期和装车时间排序
  allRecords.sort((a, b) => {
    const dateCompare = a.collectionDate.getTime() - b.collectionDate.getTime();
    if (dateCompare !== 0) return dateCompare;
    return a.loadingTime.getTime() - b.loadingTime.getTime();
  });

  // 重新编号
  allRecords.forEach((record, index) => {
    record.recordNo = generateRecordNo("CR", index + 1, record.collectionDate);
  });

  console.log(
    `重新分配完成：将 ${tripsToMove.length} 趟行程（共 ${
      tripsToMove.flat().length
    } 条记录）分配到最后 ${daysToFill} 天`
  );

  return allRecords;
}

/**
 * 生成收集台账数据（不包含转移记录）
 * @param taskId 任务ID
 * @param collectionPointId 收集点ID
 * @param startDate 开始日期
 * @param endDate 结束日期
 * @param targetTonnage 目标吨数
 * @param maxTripsPerVehiclePerDay 每辆车每天最大趟数（从出发到卸车算一趟）
 */
export async function generateLedgerData(
  taskId: string,
  collectionPointId: string,
  startDate: Date,
  endDate: Date,
  targetTonnage: number,
  maxTripsPerVehiclePerDay: number = 2
): Promise<{ collectionRecords: CollectionRecordData[] }> {
  const config = await getConfig();
  const totalDays = getDaysInRange(startDate, endDate);

  const [allStores, collectionVehicles, collectionPoint] = await Promise.all([
    prisma.store.findMany({
      where: { collectionPointId, status: "ACTIVE" },
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
      where: { collectionPointId, type: "COLLECTION", status: "ACTIVE" },
      select: { id: true, plateNumber: true, maxLoad: true, tareWeight: true },
    }),
    prisma.collectionPoint.findUnique({
      where: { id: collectionPointId },
      select: { id: true, longitude: true, latitude: true },
    }),
  ]);

  if (!collectionPoint) {
    throw new Error("收集点不存在");
  }

  // 过滤掉预估时间为 0 或没有预估时间的门店
  const stores: StoreInfo[] = allStores.filter(
    (store) => store.estimatedTravelMinutes && store.estimatedTravelMinutes > 0
  );

  if (stores.length === 0) {
    throw new Error("该收集点没有可用的门店（所有门店预估时间为空或为0）");
  }
  if (collectionVehicles.length === 0) {
    throw new Error("该收集点没有可用的收集车辆");
  }

  const collectionRecords: CollectionRecordData[] = [];
  const scheduler = new VehicleScheduler();
  // 使用配置的收集间隔范围（随机冷却期）
  const storeSelector = new StoreSelector(
    config.collectionIntervalMin,
    config.collectionIntervalMax
  );

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
      let tripTargetWeight =
        remainingTarget / Math.max(1, remainingTripsEstimate);
      tripTargetWeight = Math.max(
        avgVehicleLoad * 0.5,
        Math.min(
          tripTargetWeight * randomFloatBetween(0.9, 1.1),
          avgVehicleLoad
        )
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
        tripTargetWeight,
        collectionDate,
        maxTripsPerVehiclePerDay
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
        // 卸车净重四舍五入到 10kg（模拟磅秤精度）
        const lossRatio = randomFloatBetween(
          config.lossRatioMin,
          config.lossRatioMax,
          5
        );
        const rawUnloadingWeight = stop.weight * (1 - lossRatio);
        const unloadingNetWeight = roundToNearest10(rawUnloadingWeight);
        // 损耗 = 装车净重 - 卸车净重（根据实际磅秤读数反算）
        const loss = stop.weight - unloadingNetWeight;

        collectionRecords.push({
          recordNo: generateRecordNo("CR", ++collectionIndex, collectionDate),
          storeId: stop.storeId,
          vehicleId: trip.vehicleId,
          collectionDate,
          loadingTime: stop.arrivalTime, // 装车时间：到达门店的时间
          unloadingTime: isLastStop ? trip.returnTime : null, // 卸车时间：只有最后一站才有
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

  // 检测并重新分配最后几天空缺的数据
  const redistributedRecords = redistributeRecordsToEmptyDays(
    collectionRecords,
    startDate,
    endDate,
    collectionVehicles,
    stores,
    collectionPoint
  );

  return { collectionRecords: redistributedRecords };
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
    throw new Error("任务不存在");
  }

  try {
    await prisma.ledgerTask.update({
      where: { id: taskId },
      data: { status: "PROCESSING", startedAt: new Date() },
    });

    await prisma.collectionRecord.deleteMany({ where: { taskId } });

    const randomTargetTonnage =
      task.targetTonnage * randomFloatBetween(1, 1.02);

    // targetTonnage 字段实际存储的是 kg 值
    const { collectionRecords } = await generateLedgerData(
      taskId,
      task.collectionPointId,
      task.startDate,
      task.endDate,
      randomTargetTonnage, // 单位: kg
      task.maxTripsPerVehiclePerDay ?? 2 // 每车每日最大趟数，默认 2
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
          ...(unloadingTime && {
            unloadingTime: adjustToChineseTimezone(unloadingTime),
          }),
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
    const vehiclesCount = new Set(collectionRecords.map((r) => r.vehicleId))
      .size;

    await prisma.ledgerTask.update({
      where: { id: taskId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        // 重量四舍五入到 10kg（模拟磅秤精度）
        actualTonnage: roundToNearest10(totalLoadingWeight),
        unloadingTonnage: roundToNearest10(totalUnloadingWeight),
        totalLoss: roundToNearest10(totalLoss),
      },
    });

    return {
      totalRecords: collectionRecords.length,
      totalLoadingWeight: roundToNearest10(totalLoadingWeight),
      totalUnloadingWeight: roundToNearest10(totalUnloadingWeight),
      totalLoss: roundToNearest10(totalLoss),
      storesCount,
      vehiclesCount,
    };
  } catch (error) {
    await prisma.ledgerTask.update({
      where: { id: taskId },
      data: {
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message : "未知错误",
      },
    });
    throw error;
  }
}
