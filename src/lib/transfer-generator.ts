import prisma from './db';

interface TransferRecordData {
  recordNo: string;
  vehicleId: string;
  transferDate: Date;
  loadingTime: Date;
  unloadingTime: Date;
  destination: string;
  tireCount: number;
  loadingNetWeight: number;
  grossWeight: number;
  tareWeight: number;
  unloadingNetWeight: number;
  loss: number;
  weighbridgeNo: string;
}

interface TimeSlot {
  loadingTime: Date;
  unloadingTime: Date;
  returnTime: Date;
}

interface GeneratorConfig {
  tireWeightKg: number;
  lossRatioMin: number;
  lossRatioMax: number;
}

export interface TransferGenerationResult {
  totalRecords: number;
  totalLoadingWeight: number;
  totalUnloadingWeight: number;
  totalLoss: number;
  vehiclesCount: number;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloatBetween(min: number, max: number, decimals: number = 2): number {
  const value = Math.random() * (max - min) + min;
  return parseFloat(value.toFixed(decimals));
}

class VehicleScheduler {
  private schedules: Map<string, TimeSlot[]> = new Map();

  getEarliestAvailableTime(vehicleId: string, date: Date, minStartHour: number): Date {
    const slots = this.schedules.get(vehicleId) || [];
    const targetDateStr = formatLocalDate(date);
    
    const todaySlots = slots.filter(slot => 
      formatLocalDate(slot.loadingTime) === targetDateStr
    ).sort((a, b) => a.returnTime.getTime() - b.returnTime.getTime());

    if (todaySlots.length === 0) {
      return new Date(date.getFullYear(), date.getMonth(), date.getDate(), minStartHour, 0, 0);
    }

    const lastSlot = todaySlots[todaySlots.length - 1];
    return new Date(lastSlot.returnTime.getTime());
  }

  hasConflict(vehicleId: string, loadingTime: Date, returnTime: Date): boolean {
    const slots = this.schedules.get(vehicleId) || [];
    
    for (const slot of slots) {
      if (
        (loadingTime >= slot.loadingTime && loadingTime < slot.returnTime) ||
        (returnTime > slot.loadingTime && returnTime <= slot.returnTime) ||
        (loadingTime <= slot.loadingTime && returnTime >= slot.returnTime)
      ) {
        return true;
      }
    }
    return false;
  }

  book(vehicleId: string, loadingTime: Date, unloadingTime: Date, returnTime: Date): void {
    if (!this.schedules.has(vehicleId)) {
      this.schedules.set(vehicleId, []);
    }
    this.schedules.get(vehicleId)!.push({ loadingTime, unloadingTime, returnTime });
  }

  getTripCountForDay(vehicleId: string, date: Date): number {
    const slots = this.schedules.get(vehicleId) || [];
    const targetDateStr = formatLocalDate(date);
    return slots.filter(slot => 
      formatLocalDate(slot.loadingTime) === targetDateStr
    ).length;
  }
}

function generateTransferTripTimes(loadingTime: Date): { unloadingTime: Date; returnTime: Date } {
  // 去程：60-120分钟
  const outboundMinutes = randomBetween(60, 120);
  const unloadingTime = new Date(loadingTime.getTime() + outboundMinutes * 60 * 1000);
  
  // 卸货过磅：30-60分钟
  const unloadMinutes = randomBetween(30, 60);
  
  // 返程：60-120分钟
  const returnMinutes = randomBetween(60, 120);
  
  // 休息时间：20-40分钟
  const restMinutes = randomBetween(20, 40);
  
  const totalMinutes = outboundMinutes + unloadMinutes + returnMinutes + restMinutes;
  const returnTime = new Date(loadingTime.getTime() + totalMinutes * 60 * 1000);
  
  return { unloadingTime, returnTime };
}

function generateRecordNo(prefix: string, index: number, date: Date): string {
  const dateStr = formatLocalDate(date).replace(/-/g, '');
  return `${prefix}-${dateStr}-${String(index).padStart(5, '0')}`;
}

function generateWeighbridgeNo(date: Date, index: number): string {
  const dateStr = formatLocalDate(date).replace(/-/g, '');
  return `WB${dateStr}${String(index).padStart(4, '0')}`;
}

async function getConfig(): Promise<GeneratorConfig> {
  const configs = await prisma.systemConfig.findMany();
  const configMap = new Map(configs.map(c => [c.key, c.value]));

  return {
    tireWeightKg: parseFloat(configMap.get('tire_weight_kg') || '10'),
    lossRatioMin: parseFloat(configMap.get('loss_ratio_min') || '0.001'),
    lossRatioMax: parseFloat(configMap.get('loss_ratio_max') || '0.005'),
  };
}

/**
 * 生成转移台账数据
 * @param collectionPointId 收集点 ID
 * @param startDate 开始日期
 * @param endDate 结束日期
 * @param targetWeightKg 目标重量（kg）
 */
export async function generateTransferData(
  collectionPointId: string,
  startDate: Date,
  endDate: Date,
  targetWeightKg: number
): Promise<{ transferRecords: TransferRecordData[] }> {
  const config = await getConfig();
  
  // 获取转移车辆
  const transferVehicles = await prisma.vehicle.findMany({
    where: { collectionPointId, type: 'TRANSFER', status: 'ACTIVE' },
    select: { id: true, plateNumber: true, maxLoad: true, tareWeight: true, tareWeightVariance: true },
  });

  if (transferVehicles.length === 0) {
    throw new Error('该收集点没有可用的转移车辆');
  }

  const transferRecords: TransferRecordData[] = [];
  const scheduler = new VehicleScheduler();
  
  // 计算日期范围内的工作日
  const workDays: Date[] = [];
  const currentDate = new Date(startDate);
  while (currentDate <= endDate) {
    const dayOfWeek = currentDate.getDay();
    // 周一到周六工作
    if (dayOfWeek >= 1 && dayOfWeek <= 6) {
      workDays.push(new Date(currentDate));
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  if (workDays.length === 0) {
    throw new Error('所选日期范围内没有工作日');
  }

  const startHour = 8;
  const endHour = 16;
  
  let transferredKg = 0;
  let transferIndex = 0;
  let dayIndex = 0;

  // 按目标重量生成转移记录
  while (transferredKg < targetWeightKg && dayIndex < workDays.length * 3) {
    const currentDay = workDays[dayIndex % workDays.length];
    
    // 选择车辆（优先选择当天行程少的）
    const sortedVehicles = [...transferVehicles].sort((a, b) => {
      const countA = scheduler.getTripCountForDay(a.id, currentDay);
      const countB = scheduler.getTripCountForDay(b.id, currentDay);
      return countA - countB;
    });

    let assigned = false;

    for (const vehicle of sortedVehicles) {
      // 每辆车每天最多2趟
      if (scheduler.getTripCountForDay(vehicle.id, currentDay) >= 2) {
        continue;
      }

      const earliestTime = scheduler.getEarliestAvailableTime(vehicle.id, currentDay, startHour);
      
      if (earliestTime.getHours() >= endHour) {
        continue;
      }

      const randomOffset = randomBetween(0, 30) * 60 * 1000;
      const loadingTime = new Date(earliestTime.getTime() + randomOffset);
      
      if (loadingTime.getHours() >= endHour) {
        continue;
      }

      const { unloadingTime, returnTime } = generateTransferTripTimes(loadingTime);
      
      if (scheduler.hasConflict(vehicle.id, loadingTime, returnTime)) {
        continue;
      }

      // 计算本次转移量（装车净重）
      const loadFactor = randomFloatBetween(0.85, 0.98);
      // vehicle.maxLoad 是 kg
      const maxNetWeight = vehicle.maxLoad * loadFactor;
      const remainingKg = targetWeightKg - transferredKg;
      const loadingNetWeight = parseFloat(Math.min(maxNetWeight, remainingKg).toFixed(2));

      // 计算折损
      const lossRatio = randomFloatBetween(config.lossRatioMin, config.lossRatioMax, 5);
      const loss = parseFloat((loadingNetWeight * lossRatio).toFixed(2));
      const unloadingNetWeight = parseFloat((loadingNetWeight - loss).toFixed(2));

      // 计算皮重（带随机微调）- vehicle.tareWeight 是 kg
      const tareVariance = vehicle.tareWeightVariance || 50;
      const actualTareWeight = parseFloat((vehicle.tareWeight + randomFloatBetween(-tareVariance, tareVariance)).toFixed(2));
      const grossWeight = parseFloat((unloadingNetWeight + actualTareWeight).toFixed(2));

      // 计算轮胎条数（给平均轮胎重量添加随机波动，模拟真实世界中轮胎重量差异）
      const avgTireWeight = config.tireWeightKg * randomFloatBetween(0.9, 1.1);
      const tireCount = Math.round(loadingNetWeight / avgTireWeight);

      scheduler.book(vehicle.id, loadingTime, unloadingTime, returnTime);

      transferRecords.push({
        recordNo: generateRecordNo('TR', ++transferIndex, currentDay),
        vehicleId: vehicle.id,
        transferDate: currentDay,
        loadingTime,
        unloadingTime,
        destination: '再生资源加工厂',
        tireCount,
        loadingNetWeight,
        grossWeight,
        tareWeight: actualTareWeight,
        unloadingNetWeight,
        loss,
        weighbridgeNo: generateWeighbridgeNo(currentDay, transferIndex),
      });

      transferredKg += loadingNetWeight;
      assigned = true;
      break;
    }

    // 如果当天所有车辆都无法分配，转到下一天
    if (!assigned) {
      dayIndex++;
    }
  }

  return { transferRecords };
}

/**
 * 执行转移台账生成任务
 */
export async function executeTransferTask(taskId: string): Promise<TransferGenerationResult> {
  const task = await prisma.transferTask.findUnique({
    where: { id: taskId },
  });

  if (!task) {
    throw new Error('任务不存在');
  }

  try {
    await prisma.transferTask.update({
      where: { id: taskId },
      data: { status: 'PROCESSING', startedAt: new Date() },
    });

    await prisma.transferRecord.deleteMany({ where: { taskId } });

    const { transferRecords } = await generateTransferData(
      task.collectionPointId,
      task.startDate,
      task.endDate,
      task.targetTonnage
    );

    await prisma.transferRecord.createMany({
      data: transferRecords.map(r => ({ ...r, taskId })),
    });

    const totalLoadingWeight = transferRecords.reduce((sum, r) => sum + r.loadingNetWeight, 0);
    const totalUnloadingWeight = transferRecords.reduce((sum, r) => sum + r.unloadingNetWeight, 0);
    const totalLoss = transferRecords.reduce((sum, r) => sum + r.loss, 0);
    const vehicleIds = new Set(transferRecords.map(r => r.vehicleId));

    await prisma.transferTask.update({
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
      totalRecords: transferRecords.length,
      totalLoadingWeight: parseFloat(totalLoadingWeight.toFixed(2)),
      totalUnloadingWeight: parseFloat(totalUnloadingWeight.toFixed(2)),
      totalLoss: parseFloat(totalLoss.toFixed(2)),
      vehiclesCount: vehicleIds.size,
    };
  } catch (error) {
    await prisma.transferTask.update({
      where: { id: taskId },
      data: {
        status: 'FAILED',
        errorMessage: error instanceof Error ? error.message : '未知错误',
      },
    });
    throw error;
  }
}
