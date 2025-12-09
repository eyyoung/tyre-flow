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
}

interface StoreInfo {
  id: string;
  code: string;
  name: string;
  estimatedTravelMinutes: number;
}

interface CollectionRecordData {
  recordNo: string;
  storeId: string;
  vehicleId: string;
  collectionDate: Date;
  loadingTime: Date;
  unloadingTime: Date;
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

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

class VehicleScheduler {
  private schedules: Map<string, TimeSlot[]> = new Map();

  getEarliestAvailableTime(vehicleId: string, year: number, month: number, day: number, minStartHour: number): Date {
    const slots = this.schedules.get(vehicleId) || [];
    const targetDateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    
    const todaySlots = slots.filter(slot => 
      formatLocalDate(slot.departureTime) === targetDateStr
    ).sort((a, b) => a.returnTime.getTime() - b.returnTime.getTime());

    if (todaySlots.length === 0) {
      return new Date(year, month - 1, day, minStartHour, 0, 0);
    }

    const lastSlot = todaySlots[todaySlots.length - 1];
    return new Date(lastSlot.returnTime.getTime());
  }

  hasConflict(vehicleId: string, departureTime: Date, returnTime: Date): boolean {
    const slots = this.schedules.get(vehicleId) || [];
    
    for (const slot of slots) {
      if (
        (departureTime >= slot.departureTime && departureTime < slot.returnTime) ||
        (returnTime > slot.departureTime && returnTime <= slot.returnTime) ||
        (departureTime <= slot.departureTime && returnTime >= slot.returnTime)
      ) {
        return true;
      }
    }
    return false;
  }

  book(vehicleId: string, departureTime: Date, arrivalTime: Date, returnTime: Date): void {
    if (!this.schedules.has(vehicleId)) {
      this.schedules.set(vehicleId, []);
    }
    this.schedules.get(vehicleId)!.push({ departureTime, arrivalTime, returnTime });
  }

  getTripCountForDay(vehicleId: string, year: number, month: number, day: number): number {
    const slots = this.schedules.get(vehicleId) || [];
    const targetDateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return slots.filter(slot => 
      formatLocalDate(slot.departureTime) === targetDateStr
    ).length;
  }
}

async function getConfig(): Promise<GeneratorConfig> {
  const configs = await prisma.systemConfig.findMany();
  const configMap = new Map(configs.map(c => [c.key, c.value]));

  return {
    tireWeightKg: parseFloat(configMap.get('tire_weight_kg') || '10'),
    collectionTireLimit: parseInt(configMap.get('collection_tire_limit') || '200'),
    // 收集间隔保持配置化：默认 7-15 天
    collectionIntervalMin: parseInt(configMap.get('collection_interval_min') || configMap.get('collection_interval_days') || '7'),
    collectionIntervalMax: parseInt(configMap.get('collection_interval_max') || '15'),
    // 降低冷门门店比例：从 10% 降为 5%，让更多门店参与收集
    coldStoreRatio: parseFloat(configMap.get('cold_store_ratio') || '0.05'),
    lossRatioMin: parseFloat(configMap.get('loss_ratio_min') || '0.001'),
    lossRatioMax: parseFloat(configMap.get('loss_ratio_max') || '0.005'),
  };
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloatBetween(min: number, max: number, decimals: number = 2): number {
  const value = Math.random() * (max - min) + min;
  return parseFloat(value.toFixed(decimals));
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
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

function generateCollectionTripTimes(
  departureTime: Date,
  estimatedTravelMinutes: number
): { arrivalTime: Date; returnTime: Date } {
  // 减少行程时间波动：从 -10~30 分钟改为 -5~15 分钟
  const travelVariance = randomBetween(-5, 15);
  const actualOutboundMinutes = Math.max(10, estimatedTravelMinutes + travelVariance);
  
  const arrivalTime = new Date(departureTime.getTime() + actualOutboundMinutes * 60 * 1000);
  
  // 装卸时间保持原有范围：10-30 分钟
  const collectionMinutes = randomBetween(10, 30);
  
  const returnVariance = randomBetween(-5, 15);
  const actualReturnMinutes = Math.max(10, estimatedTravelMinutes + returnVariance);
  
  // 减少休息时间：从 10-20 分钟改为 5-10 分钟
  const restMinutes = randomBetween(5, 10);
  
  const totalMinutes = actualOutboundMinutes + collectionMinutes + actualReturnMinutes + restMinutes;
  const returnTime = new Date(departureTime.getTime() + totalMinutes * 60 * 1000);
  
  return { arrivalTime, returnTime };
}

function generateRecordNo(prefix: string, index: number, date: Date): string {
  const dateStr = formatLocalDate(date).replace(/-/g, '');
  return `${prefix}-${dateStr}-${String(index).padStart(5, '0')}`;
}

/**
 * 生成每日收集任务列表
 * 
 * 算法思路：
 * 1. 根据目标吨数计算需要的总趟数
 * 2. 将趟数均匀分配到每一天
 * 3. 每天的趟数尽量均匀分配给各个车辆
 * 4. 确保最终总重量接近目标（±10%）
 */
function generateDailyCollectionTasks(
  stores: StoreInfo[],
  targetWeightKg: number,
  totalDays: number,
  vehicleCount: number,
  config: GeneratorConfig,
  maxVehicleLoad: number
): Array<{ storeId: string; estimatedTravelMinutes: number; dayOffset: number; targetWeight: number }> {
  const tasks: Array<{ storeId: string; estimatedTravelMinutes: number; dayOffset: number; targetWeight: number }> = [];
  
  // 单次收集重量范围：车辆最大载重的 30%~90%（更真实的范围）
  const MIN_WEIGHT_PER_COLLECTION = Math.max(500, maxVehicleLoad * 0.3);
  const MAX_WEIGHT_PER_COLLECTION = maxVehicleLoad * 0.9;
  
  // 平均每次收集重量（取中间值）
  const avgWeightPerTrip = (MIN_WEIGHT_PER_COLLECTION + MAX_WEIGHT_PER_COLLECTION) / 2;
  
  // 计算需要的总趟数（根据目标吨数）
  const totalTripsNeeded = Math.ceil(targetWeightKg / avgWeightPerTrip);
  
  // 每天需要的趟数（均匀分配）
  const baseTripsPerDay = Math.floor(totalTripsNeeded / totalDays);
  const extraTrips = totalTripsNeeded % totalDays; // 余数分配到前几天
  
  // 打乱门店顺序
  const shuffledStores = [...stores].sort(() => Math.random() - 0.5);
  
  // 冷门门店：5% 的门店收集频率降低
  const coldStoreCount = Math.floor(stores.length * config.coldStoreRatio);
  const coldStoreIds = new Set(shuffledStores.slice(0, coldStoreCount).map(s => s.id));
  
  // 活跃门店（排除冷门店）
  const activeStores = shuffledStores.filter(s => !coldStoreIds.has(s.id));
  
  if (activeStores.length === 0) {
    throw new Error('没有足够的活跃门店');
  }
  
  let taskIndex = 0;
  
  // 为每一天生成任务
  for (let dayOffset = 0; dayOffset < totalDays; dayOffset++) {
    // 这一天需要的任务数量（前 extraTrips 天多分配 1 趟）
    const tasksForDay = baseTripsPerDay + (dayOffset < extraTrips ? 1 : 0);
    
    // 检查是否超过车辆运力限制（每车最多12趟）
    const maxTasksPerDay = vehicleCount * 12;
    const actualTasksForDay = Math.min(tasksForDay, maxTasksPerDay);
    
    // 轮询分配给各个门店
    for (let i = 0; i < actualTasksForDay; i++) {
      // 轮询选择门店，确保均匀分配
      const storeIndex = taskIndex % activeStores.length;
      const store = activeStores[storeIndex];
      taskIndex++;
      
      // 每次收集重量在范围内随机波动
      const weight = randomFloatBetween(
        MIN_WEIGHT_PER_COLLECTION,
        MAX_WEIGHT_PER_COLLECTION,
        0
      );
      
      tasks.push({
        storeId: store.id,
        estimatedTravelMinutes: store.estimatedTravelMinutes,
        dayOffset,
        targetWeight: weight,
      });
    }
  }
  
  // 处理冷门门店：每个冷门店在整个周期内只收集 1-2 次
  const coldStores = shuffledStores.filter(s => coldStoreIds.has(s.id));
  for (const store of coldStores) {
    // 随机选 1-2 天
    const collectionCount = randomBetween(1, 2);
    for (let i = 0; i < collectionCount; i++) {
      const dayOffset = randomBetween(0, totalDays - 1);
      const weight = randomFloatBetween(MIN_WEIGHT_PER_COLLECTION, MAX_WEIGHT_PER_COLLECTION * 0.6, 0);
      
      tasks.push({
        storeId: store.id,
        estimatedTravelMinutes: store.estimatedTravelMinutes,
        dayOffset,
        targetWeight: weight,
      });
    }
  }
  
  // 按日期排序
  tasks.sort((a, b) => a.dayOffset - b.dayOffset);
  
  return tasks;
}

function assignCollectionVehicle(
  vehicles: Array<{ id: string; plateNumber: string; maxLoad: number }>,
  scheduler: VehicleScheduler,
  year: number,
  month: number,
  day: number,
  estimatedTravelMinutes: number
): { vehicle: typeof vehicles[0]; departureTime: Date; arrivalTime: Date; returnTime: Date } | null {
  // 司机工作时间：8:00-18:00
  const startHour = 8;
  const endHour = 18;
  
  const sortedVehicles = [...vehicles].sort((a, b) => {
    const countA = scheduler.getTripCountForDay(a.id, year, month, day);
    const countB = scheduler.getTripCountForDay(b.id, year, month, day);
    return countA - countB;
  });
  
  for (const vehicle of sortedVehicles) {
    // 增加每日最大趟数：从 8 趟改为 12 趟
    if (scheduler.getTripCountForDay(vehicle.id, year, month, day) >= 12) {
      continue;
    }
    
    const earliestTime = scheduler.getEarliestAvailableTime(vehicle.id, year, month, day, startHour);
    
    if (earliestTime.getHours() >= endHour) {
      continue;
    }
    
    // 减少随机等待时间：从 0-20 分钟改为 0-10 分钟，让行程更紧凑
    const randomOffset = randomBetween(0, 10) * 60 * 1000;
    const departureTime = new Date(earliestTime.getTime() + randomOffset);
    
    if (departureTime.getHours() >= endHour) {
      continue;
    }
    
    const { arrivalTime, returnTime } = generateCollectionTripTimes(departureTime, estimatedTravelMinutes);
    
    if (scheduler.hasConflict(vehicle.id, departureTime, returnTime)) {
      continue;
    }
    
    return { vehicle, departureTime, arrivalTime, returnTime };
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

  const [allStores, collectionVehicles] = await Promise.all([
    prisma.store.findMany({
      where: { collectionPointId, status: 'ACTIVE' },
      select: { id: true, code: true, name: true, estimatedTravelMinutes: true },
    }),
    prisma.vehicle.findMany({
      where: { collectionPointId, type: 'COLLECTION', status: 'ACTIVE' },
      select: { id: true, plateNumber: true, maxLoad: true },
    }),
  ]);

  // 过滤掉预估时间为 0 或没有预估时间的门店
  const stores = allStores.filter(
    (store) => store.estimatedTravelMinutes && store.estimatedTravelMinutes > 0
  );

  if (stores.length === 0) {
    throw new Error('该收集点没有可用的门店（所有门店预估时间为空或为0）');
  }
  if (collectionVehicles.length === 0) {
    throw new Error('该收集点没有可用的收集车辆');
  }

  const collectionRecords: CollectionRecordData[] = [];
  const collectionScheduler = new VehicleScheduler();

  // 获取收集车辆的最大载重（取所有收集车辆中的最大值）
  const maxVehicleLoad = Math.max(...collectionVehicles.map(v => v.maxLoad));
  
  // 生成任务列表（只是分配门店和日期，不指定具体重量）
  const allCollectionTasks = generateDailyCollectionTasks(
    stores,
    targetTonnage,
    totalDays,
    collectionVehicles.length,
    config,
    maxVehicleLoad
  );
  
  // ========== 动态调整算法 ==========
  // 跟踪累计重量，动态调整每次收集量，确保最终接近目标
  let accumulatedWeight = 0;
  let collectionIndex = 0;
  let successfulTasks = 0;
  
  // 重量范围
  const MIN_WEIGHT = Math.max(500, maxVehicleLoad * 0.25);
  const MAX_WEIGHT = maxVehicleLoad * 0.95;
  const MIN_TIRE_COUNT = 30;
  
  for (let taskIndex = 0; taskIndex < allCollectionTasks.length; taskIndex++) {
    const task = allCollectionTasks[taskIndex];
    
    // 计算剩余目标和剩余任务
    const remainingTarget = targetTonnage - accumulatedWeight;
    const remainingTasks = allCollectionTasks.length - taskIndex;
    
    // 如果已经达到或超过目标的 99%，停止生成
    if (accumulatedWeight >= targetTonnage * 0.99) {
      break;
    }
    
    // 如果剩余目标很小（不足一趟的最小量），停止
    if (remainingTarget < MIN_WEIGHT * 0.5) {
      break;
    }
    
    const targetDate = getDateFromRange(startDate, task.dayOffset);
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth() + 1;
    const day = targetDate.getDate();
    
    const assignment = assignCollectionVehicle(
      collectionVehicles,
      collectionScheduler,
      year,
      month,
      day,
      task.estimatedTravelMinutes
    );
    
    if (!assignment) {
      continue;
    }
    
    const { vehicle, departureTime, arrivalTime, returnTime } = assignment;
    
    // ========== 动态计算这一趟的目标重量 ==========
    // 理想重量 = 剩余目标 / 剩余任务数
    const idealWeight = remainingTarget / Math.max(1, remainingTasks);
    
    // 在理想值附近随机波动（±20%），但不超过边界
    let targetWeight = idealWeight * randomFloatBetween(0.8, 1.2);
    targetWeight = Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, targetWeight));
    
    // 如果接近目标（剩余 < 5趟的量），减小波动范围，更精确控制
    if (remainingTasks <= 5) {
      targetWeight = Math.min(targetWeight, remainingTarget * 0.9);
    }
    
    // 根据重量计算轮胎数量
    const maxTiresByVehicle = Math.floor(vehicle.maxLoad / config.tireWeightKg);
    const tireCount = Math.round(targetWeight / config.tireWeightKg);
    const actualTireCount = Math.max(MIN_TIRE_COUNT, Math.min(tireCount, maxTiresByVehicle));
    
    // 给轮胎重量添加随机波动（±8%）
    const avgTireWeight = config.tireWeightKg * randomFloatBetween(0.92, 1.08);
    const loadingNetWeight = parseFloat((actualTireCount * avgTireWeight).toFixed(2));
    
    // 生成折损
    const lossRatio = randomFloatBetween(config.lossRatioMin, config.lossRatioMax, 5);
    const loss = parseFloat((loadingNetWeight * lossRatio).toFixed(2));
    const unloadingNetWeight = parseFloat((loadingNetWeight - loss).toFixed(2));
    
    const collectionDate = new Date(year, month - 1, day);
    
    collectionScheduler.book(vehicle.id, departureTime, arrivalTime, returnTime);
    
    collectionRecords.push({
      recordNo: generateRecordNo('CR', ++collectionIndex, collectionDate),
      storeId: task.storeId,
      vehicleId: vehicle.id,
      collectionDate,
      loadingTime: departureTime,
      unloadingTime: arrivalTime,
      tireCount: actualTireCount,
      loadingNetWeight,
      unloadingNetWeight,
      loss,
    });
    
    // 累计重量
    accumulatedWeight += loadingNetWeight;
    successfulTasks++;
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
export async function executeLedgerTask(taskId: string): Promise<LedgerGenerationResult> {
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
      data: collectionRecords.map(r => ({
        ...r,
        taskId,
        collectionDate: adjustToChineseTimezone(r.collectionDate),
        loadingTime: adjustToChineseTimezone(r.loadingTime),
        unloadingTime: adjustToChineseTimezone(r.unloadingTime),
      })),
    });

    // 所有重量单位为 kg
    const totalLoadingWeight = collectionRecords.reduce((sum, r) => sum + r.loadingNetWeight, 0);
    const totalUnloadingWeight = collectionRecords.reduce((sum, r) => sum + r.unloadingNetWeight, 0);
    const totalLoss = collectionRecords.reduce((sum, r) => sum + r.loss, 0);
    const storesCount = new Set(collectionRecords.map(r => r.storeId)).size;
    const vehiclesCount = new Set(collectionRecords.map(r => r.vehicleId)).size;

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
