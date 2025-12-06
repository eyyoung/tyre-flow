import prisma from './db';

interface GeneratorConfig {
  tireWeightKg: number;
  collectionTireLimit: number;
  collectionIntervalMin: number;
  collectionIntervalMax: number;
  coldStoreRatio: number;
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
  departureTime: Date;
  arrivalTime: Date;
  tireCount: number;
  weight: number;
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
  targetTonnage: number,
  daysInMonth: number,
  config: GeneratorConfig
): StoreCollectionPlan[] {
  const plans: StoreCollectionPlan[] = [];
  
  const shuffledStores = [...stores].sort(() => Math.random() - 0.5);
  const coldStoreCount = Math.floor(stores.length * config.coldStoreRatio);
  const coldStores = new Set(shuffledStores.slice(0, coldStoreCount).map(s => s.id));
  
  const activeStores = stores.filter(s => !coldStores.has(s.id));
  
  const avgInterval = (config.collectionIntervalMin + config.collectionIntervalMax) / 2;
  const avgCollectionsPerStore = Math.ceil(daysInMonth / avgInterval);
  
  const avgWeightPerCollection = 0.8;
  const totalCollections = Math.ceil(targetTonnage / avgWeightPerCollection);
  const neededActiveStores = Math.min(
    activeStores.length,
    Math.ceil(totalCollections / avgCollectionsPerStore)
  );
  
  const participatingStores = activeStores.slice(0, neededActiveStores);
  
  let remainingTonnage = targetTonnage;
  
  for (const store of participatingStores) {
    if (remainingTonnage <= 0) break;
    
    const collectionDays: number[] = [];
    let currentDay = randomBetween(1, Math.min(5, daysInMonth));
    
    while (currentDay <= daysInMonth) {
      collectionDays.push(currentDay);
      const interval = randomBetween(config.collectionIntervalMin, config.collectionIntervalMax);
      currentDay += interval;
    }
    
    if (collectionDays.length === 0) continue;
    
    const storeTargetWeight = Math.min(
      remainingTonnage,
      randomFloatBetween(0.3, 2.0) * collectionDays.length
    );
    
    const weightPerCollection = storeTargetWeight / collectionDays.length;
    
    plans.push({
      storeId: store.id,
      estimatedTravelMinutes: store.estimatedTravelMinutes,
      collectionDays,
      weightPerCollection,
    });
    
    remainingTonnage -= storeTargetWeight;
  }
  
  if (remainingTonnage > 0 && coldStoreCount > 0) {
    const coldStoreList = shuffledStores.slice(0, coldStoreCount);
    const coldParticipants = coldStoreList.slice(0, Math.ceil(coldStoreCount * 0.3));
    
    for (const store of coldParticipants) {
      if (remainingTonnage <= 0) break;
      
      const collectionDay = randomBetween(10, daysInMonth - 5);
      const weight = Math.min(remainingTonnage, randomFloatBetween(0.2, 0.8));
      
      plans.push({
        storeId: store.id,
        estimatedTravelMinutes: store.estimatedTravelMinutes,
        collectionDays: [collectionDay],
        weightPerCollection: weight,
      });
      
      remainingTonnage -= weight;
    }
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
 */
export async function generateLedgerData(
  taskId: string,
  collectionPointId: string,
  year: number,
  month: number,
  targetTonnage: number
): Promise<{ collectionRecords: CollectionRecordData[] }> {
  const config = await getConfig();
  const daysInMonth = getDaysInMonth(year, month);

  const [stores, collectionVehicles] = await Promise.all([
    prisma.store.findMany({
      where: { collectionPointId, status: 'ACTIVE' },
      select: { id: true, code: true, name: true, estimatedTravelMinutes: true },
    }),
    prisma.vehicle.findMany({
      where: { collectionPointId, type: 'COLLECTION', status: 'ACTIVE' },
      select: { id: true, plateNumber: true, maxLoad: true },
    }),
  ]);

  if (stores.length === 0) {
    throw new Error('该收集点没有可用的门店');
  }
  if (collectionVehicles.length === 0) {
    throw new Error('该收集点没有可用的收集车辆');
  }

  const collectionRecords: CollectionRecordData[] = [];
  const collectionScheduler = new VehicleScheduler();

  const storePlans = generateStoreCollectionPlans(stores, targetTonnage, daysInMonth, config);
  
  const allCollectionTasks: Array<{
    storeId: string;
    estimatedTravelMinutes: number;
    day: number;
    targetWeight: number;
  }> = [];
  
  for (const plan of storePlans) {
    for (const day of plan.collectionDays) {
      allCollectionTasks.push({
        storeId: plan.storeId,
        estimatedTravelMinutes: plan.estimatedTravelMinutes,
        day,
        targetWeight: plan.weightPerCollection,
      });
    }
  }
  
  allCollectionTasks.sort((a, b) => a.day - b.day);
  
  let collectionIndex = 0;
  
  for (const task of allCollectionTasks) {
    const assignment = assignCollectionVehicle(
      collectionVehicles,
      collectionScheduler,
      year,
      month,
      task.day,
      task.estimatedTravelMinutes
    );
    
    if (!assignment) {
      continue;
    }
    
    const { vehicle, departureTime, arrivalTime, returnTime } = assignment;
    
    const actualWeight = task.targetWeight * randomFloatBetween(0.8, 1.2);
    const tireCount = Math.max(1, Math.round(actualWeight * 1000 / config.tireWeightKg));
    
    const maxTires = Math.floor(vehicle.maxLoad * 1000 / config.tireWeightKg);
    const actualTireCount = Math.min(tireCount, maxTires, config.collectionTireLimit);
    const actualWeightTon = actualTireCount * config.tireWeightKg / 1000;
    
    const collectionDate = new Date(year, month - 1, task.day);
    
    collectionScheduler.book(vehicle.id, departureTime, arrivalTime, returnTime);
    
    collectionRecords.push({
      recordNo: generateRecordNo('CR', ++collectionIndex, collectionDate),
      storeId: task.storeId,
      vehicleId: vehicle.id,
      collectionDate,
      departureTime,
      arrivalTime,
      tireCount: actualTireCount,
      weight: actualWeightTon,
    });
  }

  return { collectionRecords };
}

/**
 * 执行收集台账生成任务
 */
export async function executeLedgerTask(taskId: string): Promise<void> {
  const task = await prisma.ledgerTask.findUnique({
    where: { id: taskId },
  });

  if (!task) {
    throw new Error('任务不存在');
  }

  if (task.status !== 'PENDING') {
    throw new Error('任务状态不正确，只能处理待处理状态的任务');
  }

  try {
    await prisma.ledgerTask.update({
      where: { id: taskId },
      data: { status: 'PROCESSING', startedAt: new Date() },
    });

    await prisma.collectionRecord.deleteMany({ where: { taskId } });

    const { collectionRecords } = await generateLedgerData(
      taskId,
      task.collectionPointId,
      task.year,
      task.month,
      task.targetTonnage
    );

    await prisma.collectionRecord.createMany({
      data: collectionRecords.map(r => ({ ...r, taskId })),
    });

    const actualTonnage = collectionRecords.reduce((sum, r) => sum + r.weight, 0);

    await prisma.ledgerTask.update({
      where: { id: taskId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        actualTonnage: parseFloat(actualTonnage.toFixed(3)),
      },
    });
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
