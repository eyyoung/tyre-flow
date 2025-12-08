import prisma from './db';

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

interface StoreCollectionPlan {
  storeId: string;
  estimatedTravelMinutes: number;
  collectionDays: number[];
  weightPerCollection: number;
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
    collectionIntervalMin: parseInt(configMap.get('collection_interval_min') || configMap.get('collection_interval_days') || '7'),
    collectionIntervalMax: parseInt(configMap.get('collection_interval_max') || '15'),
    coldStoreRatio: parseFloat(configMap.get('cold_store_ratio') || '0.1'),
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
  const travelVariance = randomBetween(-10, 30);
  const actualOutboundMinutes = Math.max(10, estimatedTravelMinutes + travelVariance);
  
  const arrivalTime = new Date(departureTime.getTime() + actualOutboundMinutes * 60 * 1000);
  
  const collectionMinutes = randomBetween(10, 30);
  
  const returnVariance = randomBetween(-10, 30);
  const actualReturnMinutes = Math.max(10, estimatedTravelMinutes + returnVariance);
  
  const restMinutes = randomBetween(10, 20);
  
  const totalMinutes = actualOutboundMinutes + collectionMinutes + actualReturnMinutes + restMinutes;
  const returnTime = new Date(departureTime.getTime() + totalMinutes * 60 * 1000);
  
  return { arrivalTime, returnTime };
}

function generateRecordNo(prefix: string, index: number, date: Date): string {
  const dateStr = formatLocalDate(date).replace(/-/g, '');
  return `${prefix}-${dateStr}-${String(index).padStart(5, '0')}`;
}

function generateStoreCollectionPlans(
  stores: StoreInfo[],
  targetWeightKg: number,
  daysInMonth: number,
  config: GeneratorConfig
): StoreCollectionPlan[] {
  const plans: StoreCollectionPlan[] = [];
  
  // 最小单次收集重量阈值 (kg)
  const MIN_WEIGHT_PER_COLLECTION = 200;
  
  const shuffledStores = [...stores].sort(() => Math.random() - 0.5);
  const coldStoreCount = Math.floor(stores.length * config.coldStoreRatio);
  const coldStores = new Set(shuffledStores.slice(0, coldStoreCount).map(s => s.id));
  
  const activeStores = stores.filter(s => !coldStores.has(s.id));
  
  const avgInterval = (config.collectionIntervalMin + config.collectionIntervalMax) / 2;
  const avgCollectionsPerStore = Math.ceil(daysInMonth / avgInterval);
  
  // 平均每次收集重量 800 kg
  const avgWeightPerCollection = 800;
  const totalCollections = Math.ceil(targetWeightKg / avgWeightPerCollection);
  const neededActiveStores = Math.min(
    activeStores.length,
    Math.ceil(totalCollections / avgCollectionsPerStore)
  );
  
  const participatingStores = activeStores.slice(0, neededActiveStores);
  
  let remainingWeightKg = targetWeightKg;
  
  for (const store of participatingStores) {
    // 如果剩余重量不足最小阈值，不再分配新门店
    if (remainingWeightKg < MIN_WEIGHT_PER_COLLECTION) break;
    
    const collectionDays: number[] = [];
    let currentDay = randomBetween(1, Math.min(5, daysInMonth));
    
    while (currentDay <= daysInMonth) {
      collectionDays.push(currentDay);
      const interval = randomBetween(config.collectionIntervalMin, config.collectionIntervalMax);
      currentDay += interval;
    }
    
    if (collectionDays.length === 0) continue;
    
    // 每次收集 300-2000 kg
    const idealWeightPerCollection = randomFloatBetween(300, 2000, 0);
    const idealTotalWeight = idealWeightPerCollection * collectionDays.length;
    
    // 计算实际分配重量
    let storeTargetWeight = Math.min(remainingWeightKg, idealTotalWeight);
    let weightPerCollection = storeTargetWeight / collectionDays.length;
    
    // 如果每次收集重量太小，减少收集天数以确保每次重量合理
    let actualCollectionDays = [...collectionDays];
    while (weightPerCollection < MIN_WEIGHT_PER_COLLECTION && actualCollectionDays.length > 1) {
      // 随机移除一个收集日
      const removeIndex = randomBetween(0, actualCollectionDays.length - 1);
      actualCollectionDays.splice(removeIndex, 1);
      weightPerCollection = storeTargetWeight / actualCollectionDays.length;
    }
    
    // 如果只剩一天但重量仍不足阈值，使用所有剩余重量（至少 MIN_WEIGHT_PER_COLLECTION）
    if (actualCollectionDays.length === 1 && weightPerCollection < MIN_WEIGHT_PER_COLLECTION) {
      weightPerCollection = Math.min(remainingWeightKg, idealWeightPerCollection);
      storeTargetWeight = weightPerCollection;
    }
    
    plans.push({
      storeId: store.id,
      estimatedTravelMinutes: store.estimatedTravelMinutes,
      collectionDays: actualCollectionDays,
      weightPerCollection,
    });
    
    remainingWeightKg -= storeTargetWeight;
  }
  
  // 处理冷门门店
  if (remainingWeightKg >= MIN_WEIGHT_PER_COLLECTION && coldStoreCount > 0) {
    const coldStoreList = shuffledStores.slice(0, coldStoreCount);
    const coldParticipants = coldStoreList.slice(0, Math.ceil(coldStoreCount * 0.3));
    
    for (const store of coldParticipants) {
      if (remainingWeightKg < MIN_WEIGHT_PER_COLLECTION) break;
      
      const collectionDay = randomBetween(10, daysInMonth - 5);
      // 冷门门店每次收集 200-800 kg，但不能低于最小阈值
      const weight = Math.max(
        MIN_WEIGHT_PER_COLLECTION,
        Math.min(remainingWeightKg, randomFloatBetween(200, 800, 0))
      );
      
      plans.push({
        storeId: store.id,
        estimatedTravelMinutes: store.estimatedTravelMinutes,
        collectionDays: [collectionDay],
        weightPerCollection: weight,
      });
      
      remainingWeightKg -= weight;
    }
  }
  
  // 如果还有少量剩余重量，合并到已有计划的最后一个门店
  if (remainingWeightKg > 0 && plans.length > 0) {
    const lastPlan = plans[plans.length - 1];
    // 将剩余重量平均分配到该门店的所有收集日
    const additionalPerDay = remainingWeightKg / lastPlan.collectionDays.length;
    lastPlan.weightPerCollection += additionalPerDay;
  }
  
  return plans;
}

function assignCollectionVehicle(
  vehicles: Array<{ id: string; plateNumber: string; maxLoad: number }>,
  scheduler: VehicleScheduler,
  year: number,
  month: number,
  day: number,
  estimatedTravelMinutes: number
): { vehicle: typeof vehicles[0]; departureTime: Date; arrivalTime: Date; returnTime: Date } | null {
  const startHour = 8;
  const endHour = 18;
  
  const sortedVehicles = [...vehicles].sort((a, b) => {
    const countA = scheduler.getTripCountForDay(a.id, year, month, day);
    const countB = scheduler.getTripCountForDay(b.id, year, month, day);
    return countA - countB;
  });
  
  for (const vehicle of sortedVehicles) {
    if (scheduler.getTripCountForDay(vehicle.id, year, month, day) >= 8) {
      continue;
    }
    
    const earliestTime = scheduler.getEarliestAvailableTime(vehicle.id, year, month, day, startHour);
    
    if (earliestTime.getHours() >= endHour) {
      continue;
    }
    
    const randomOffset = randomBetween(0, 20) * 60 * 1000;
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

  const storePlans = generateStoreCollectionPlans(stores, targetTonnage, totalDays, config);
  
  const allCollectionTasks: Array<{
    storeId: string;
    estimatedTravelMinutes: number;
    dayOffset: number;
    targetWeight: number;
  }> = [];
  
  for (const plan of storePlans) {
    for (const day of plan.collectionDays) {
      allCollectionTasks.push({
        storeId: plan.storeId,
        estimatedTravelMinutes: plan.estimatedTravelMinutes,
        dayOffset: day - 1, // 转换为从0开始的偏移量
        targetWeight: plan.weightPerCollection,
      });
    }
  }
  
  allCollectionTasks.sort((a, b) => a.dayOffset - b.dayOffset);
  
  let collectionIndex = 0;
  
  for (const task of allCollectionTasks) {
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
    
    // 最小轮胎数量（确保每次收集有合理数量，避免出现1-2条的异常数据）
    const MIN_TIRE_COUNT = 20;
    
    // task.targetWeight 现在是 kg
    const actualWeightKg = task.targetWeight * randomFloatBetween(0.8, 1.2);
    const tireCount = Math.max(MIN_TIRE_COUNT, Math.round(actualWeightKg / config.tireWeightKg));
    
    // vehicle.maxLoad 现在是 kg，确保至少能装 MIN_TIRE_COUNT 个轮胎
    const maxTires = Math.max(MIN_TIRE_COUNT, Math.floor(vehicle.maxLoad / config.tireWeightKg));
    const actualTireCount = Math.min(tireCount, maxTires, config.collectionTireLimit);
    
    // 重量单位：kg
    // 给轮胎重量添加随机波动（±10%），模拟真实世界中每个轮胎重量的差异
    const avgTireWeight = config.tireWeightKg * randomFloatBetween(0.9, 1.1);
    const loadingNetWeight = parseFloat((actualTireCount * avgTireWeight).toFixed(2));
    
    // 生成折损：卸车净重 = 装车净重 - 折损，模拟运输过程中的轻微损耗
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

    await prisma.collectionRecord.createMany({
      data: collectionRecords.map(r => ({ ...r, taskId })),
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
