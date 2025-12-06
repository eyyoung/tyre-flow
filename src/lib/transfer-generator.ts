import prisma from './db';

interface TransferRecordData {
  recordNo: string;
  vehicleId: string;
  transferDate: Date;
  departureTime: Date;
  arrivalTime: Date;
  destination: string;
  tireCount: number;
  grossWeight: number;
  tareWeight: number;
  netWeight: number;
  weighbridgeNo: string;
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
      formatLocalDate(slot.departureTime) === targetDateStr
    ).sort((a, b) => a.returnTime.getTime() - b.returnTime.getTime());

    if (todaySlots.length === 0) {
      return new Date(date.getFullYear(), date.getMonth(), date.getDate(), minStartHour, 0, 0);
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

  getTripCountForDay(vehicleId: string, date: Date): number {
    const slots = this.schedules.get(vehicleId) || [];
    const targetDateStr = formatLocalDate(date);
    return slots.filter(slot => 
      formatLocalDate(slot.departureTime) === targetDateStr
    ).length;
  }
}

function generateTransferTripTimes(departureTime: Date): { arrivalTime: Date; returnTime: Date } {
  // 去程：60-120分钟
  const outboundMinutes = randomBetween(60, 120);
  const arrivalTime = new Date(departureTime.getTime() + outboundMinutes * 60 * 1000);
  
  // 卸货过磅：30-60分钟
  const unloadMinutes = randomBetween(30, 60);
  
  // 返程：60-120分钟
  const returnMinutes = randomBetween(60, 120);
  
  // 休息时间：20-40分钟
  const restMinutes = randomBetween(20, 40);
  
  const totalMinutes = outboundMinutes + unloadMinutes + returnMinutes + restMinutes;
  const returnTime = new Date(departureTime.getTime() + totalMinutes * 60 * 1000);
  
  return { arrivalTime, returnTime };
}

function generateRecordNo(prefix: string, index: number, date: Date): string {
  const dateStr = formatLocalDate(date).replace(/-/g, '');
  return `${prefix}-${dateStr}-${String(index).padStart(5, '0')}`;
}

function generateWeighbridgeNo(date: Date, index: number): string {
  const dateStr = formatLocalDate(date).replace(/-/g, '');
  return `WB${dateStr}${String(index).padStart(4, '0')}`;
}

async function getConfig(): Promise<{ tireWeightKg: number }> {
  const configs = await prisma.systemConfig.findMany();
  const configMap = new Map(configs.map(c => [c.key, c.value]));

  return {
    tireWeightKg: parseFloat(configMap.get('tire_weight_kg') || '10'),
  };
}

/**
 * 生成转移台账数据
 * @param collectionPointId 收集点 ID
 * @param targetTonnage 目标吨数
 */
export async function generateTransferData(
  collectionPointId: string,
  targetTonnage: number
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
  
  // 使用当天日期
  const today = new Date();
  const startHour = 8;
  const endHour = 16;
  
  let transferredTons = 0;
  let transferIndex = 0;

  // 按目标吨数生成转移记录
  while (transferredTons < targetTonnage) {
    // 选择车辆（优先选择当天行程少的）
    const sortedVehicles = [...transferVehicles].sort((a, b) => {
      const countA = scheduler.getTripCountForDay(a.id, today);
      const countB = scheduler.getTripCountForDay(b.id, today);
      return countA - countB;
    });

    let assigned = false;

    for (const vehicle of sortedVehicles) {
      // 每辆车每天最多2趟
      if (scheduler.getTripCountForDay(vehicle.id, today) >= 2) {
        continue;
      }

      const earliestTime = scheduler.getEarliestAvailableTime(vehicle.id, today, startHour);
      
      if (earliestTime.getHours() >= endHour) {
        continue;
      }

      const randomOffset = randomBetween(0, 30) * 60 * 1000;
      const departureTime = new Date(earliestTime.getTime() + randomOffset);
      
      if (departureTime.getHours() >= endHour) {
        continue;
      }

      const { arrivalTime, returnTime } = generateTransferTripTimes(departureTime);
      
      if (scheduler.hasConflict(vehicle.id, departureTime, returnTime)) {
        continue;
      }

      // 计算本次转移量
      const loadFactor = randomFloatBetween(0.85, 0.98);
      const maxNetWeight = vehicle.maxLoad * loadFactor;
      const remainingTonnage = targetTonnage - transferredTons;
      const netWeight = Math.min(maxNetWeight, remainingTonnage);

      // 计算皮重（带随机微调）
      const tareVariance = vehicle.tareWeightVariance || 0.05;
      const actualTareWeight = vehicle.tareWeight * (1 + randomFloatBetween(-tareVariance, tareVariance));
      const grossWeight = netWeight + actualTareWeight;

      // 计算轮胎条数
      const tireCount = Math.round(netWeight * 1000 / config.tireWeightKg);

      scheduler.book(vehicle.id, departureTime, arrivalTime, returnTime);

      transferRecords.push({
        recordNo: generateRecordNo('TR', ++transferIndex, today),
        vehicleId: vehicle.id,
        transferDate: today,
        departureTime,
        arrivalTime,
        destination: '再生资源加工厂',
        tireCount,
        grossWeight: parseFloat(grossWeight.toFixed(3)),
        tareWeight: parseFloat(actualTareWeight.toFixed(3)),
        netWeight: parseFloat(netWeight.toFixed(3)),
        weighbridgeNo: generateWeighbridgeNo(today, transferIndex),
      });

      transferredTons += netWeight;
      assigned = true;
      break;
    }

    // 如果所有车辆都无法分配，退出循环
    if (!assigned) {
      break;
    }
  }

  return { transferRecords };
}

/**
 * 执行转移台账生成任务
 */
export async function executeTransferTask(taskId: string): Promise<void> {
  const task = await prisma.transferTask.findUnique({
    where: { id: taskId },
  });

  if (!task) {
    throw new Error('任务不存在');
  }

  if (task.status !== 'PENDING') {
    throw new Error('任务状态不正确，只能处理待处理状态的任务');
  }

  try {
    await prisma.transferTask.update({
      where: { id: taskId },
      data: { status: 'PROCESSING', startedAt: new Date() },
    });

    await prisma.transferRecord.deleteMany({ where: { taskId } });

    const { transferRecords } = await generateTransferData(
      task.collectionPointId,
      task.targetTonnage
    );

    await prisma.transferRecord.createMany({
      data: transferRecords.map(r => ({ ...r, taskId })),
    });

    const actualTonnage = transferRecords.reduce((sum, r) => sum + r.netWeight, 0);

    await prisma.transferTask.update({
      where: { id: taskId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        actualTonnage: parseFloat(actualTonnage.toFixed(3)),
      },
    });
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

