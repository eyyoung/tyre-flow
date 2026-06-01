import prisma from "./db";
import { adjustToChineseTimezone } from "./timezone";

interface TransferRecordData {
  recordNo: string;
  vehicleId: string;
  transferDate: Date;
  destination: string;
  tireCount: number;
  loadingNetWeight: number;
  grossWeight: number;
  tareWeight: number;
  unloadingNetWeight: number;
  loss: number;
  weighbridgeNo: string;
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
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function generateRecordNo(
  prefix: string,
  collectionPointCode: string,
  index: number,
  date: Date
): string {
  const dateStr = formatLocalDate(date).replace(/-/g, "");
  return [
    prefix,
    dateStr,
    collectionPointCode,
    String(index).padStart(5, "0"),
  ].join("-");
}

function generateWeighbridgeNo(date: Date, index: number): string {
  const dateStr = formatLocalDate(date).replace(/-/g, "");
  return `WB${dateStr}${String(index).padStart(4, "0")}`;
}

async function getConfig(): Promise<GeneratorConfig> {
  const configs = await prisma.systemConfig.findMany();
  const configMap = new Map(configs.map((c) => [c.key, c.value]));

  return {
    tireWeightKg: parseFloat(configMap.get("tire_weight_kg") || "10"),
    lossRatioMin: parseFloat(configMap.get("loss_ratio_min") || "0.001"),
    lossRatioMax: parseFloat(configMap.get("loss_ratio_max") || "0.005"),
  };
}

/**
 * 生成转移台账数据
 * 转移任务会均匀分配到选定日期范围内的每一个工作日
 *
 * @param collectionPointId 收集点 ID
 * @param startDate 开始日期
 * @param endDate 结束日期
 * @param targetWeightKg 目标重量（kg）
 * @param factoryName 目标工厂名称
 */
export async function generateTransferData(
  collectionPointId: string,
  startDate: Date,
  endDate: Date,
  targetWeightKg: number,
  factoryName: string = "再生资源加工厂"
): Promise<{ transferRecords: TransferRecordData[] }> {
  const config = await getConfig();

  const [transferVehicles, collectionPoint] = await Promise.all([
    prisma.vehicle.findMany({
      where: { collectionPointId, type: "TRANSFER", status: "ACTIVE" },
      select: {
        id: true,
        plateNumber: true,
        maxLoad: true,
        tareWeight: true,
        tareWeightVariance: true,
      },
    }),
    prisma.collectionPoint.findUnique({
      where: { id: collectionPointId },
      select: { code: true },
    }),
  ]);

  if (!collectionPoint) {
    throw new Error("收集点不存在");
  }

  if (transferVehicles.length === 0) {
    throw new Error("该收集点没有可用的转移车辆");
  }

  const transferRecords: TransferRecordData[] = [];

  // 计算日期范围内的工作日（周一到周六）
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
    throw new Error("所选日期范围内没有工作日");
  }

  // 计算车辆平均载重（考虑装载系数 95%-105%，转移任务会尽量装满）
  const avgLoadFactor = 1.0; // 平均装载系数
  const avgVehicleCapacity =
    (transferVehicles.reduce((sum, v) => sum + v.maxLoad, 0) /
      transferVehicles.length) *
    avgLoadFactor;

  const randomTargetWeightKg = randomFloatBetween(
    targetWeightKg * 1,
    targetWeightKg * 1.03
  );
  // 计算总共需要多少车次（向上取整确保能达到目标）
  const totalTripsNeeded = Math.ceil(randomTargetWeightKg / avgVehicleCapacity);

  // 使用累积分配方式，将车次均匀分布到所有工作日
  // 每天的累积目标车次 = (天数索引 + 1) / 总工作日数 * 总车次数
  // 当累积目标超过已分配车次时，分配新的车次

  let globalIndex = 0;
  let allocatedTrips = 0; // 已分配的总车次数

  // 跟踪每辆车每天的使用次数
  const vehicleDayUsage: Map<string, Map<string, number>> = new Map();

  const getVehicleUsageForDay = (vehicleId: string, date: Date): number => {
    const dateStr = formatLocalDate(date);
    const vehicleUsage = vehicleDayUsage.get(vehicleId);
    if (!vehicleUsage) return 0;
    return vehicleUsage.get(dateStr) || 0;
  };

  const incrementVehicleUsage = (vehicleId: string, date: Date): void => {
    const dateStr = formatLocalDate(date);
    if (!vehicleDayUsage.has(vehicleId)) {
      vehicleDayUsage.set(vehicleId, new Map());
    }
    const current = vehicleDayUsage.get(vehicleId)!.get(dateStr) || 0;
    vehicleDayUsage.get(vehicleId)!.set(dateStr, current + 1);
  };

  // 生成单条转移记录的辅助函数
  const generateTransferRecord = (workDay: Date) => {
    // 选择车辆（优先选择当天使用次数少的）
    const sortedVehicles = [...transferVehicles].sort((a, b) => {
      const countA = getVehicleUsageForDay(a.id, workDay);
      const countB = getVehicleUsageForDay(b.id, workDay);
      return countA - countB;
    });

    // 从使用次数最少的车辆中随机选择一辆（增加多样性）
    const minUsage = getVehicleUsageForDay(sortedVehicles[0].id, workDay);
    const candidateVehicles = sortedVehicles.filter(
      (v) => getVehicleUsageForDay(v.id, workDay) === minUsage
    );
    const vehicle =
      candidateVehicles[randomBetween(0, candidateVehicles.length - 1)];

    // 计算本次转移量（装车净重）- 四舍五入到 10kg（模拟磅秤精度）
    // 转移任务会尽量装满，甚至有一定超载（95%~105%）
    const loadFactor = randomFloatBetween(0.95, 1.05);
    const loadingNetWeight = roundToNearest10(vehicle.maxLoad * loadFactor);

    // 计算折损
    const lossRatio = randomFloatBetween(
      config.lossRatioMin,
      config.lossRatioMax,
      5
    );
    // 卸车净重四舍五入到 10kg（模拟磅秤精度）
    const rawUnloadingWeight = loadingNetWeight * (1 - lossRatio);
    const unloadingNetWeight = roundToNearest10(rawUnloadingWeight);
    // 损耗 = 装车净重 - 卸车净重（根据实际磅秤读数反算）
    const loss = loadingNetWeight - unloadingNetWeight;

    // 计算皮重（带随机微调）- 四舍五入到 10kg（模拟磅秤精度）
    const tareVariance = vehicle.tareWeightVariance || 50;
    const actualTareWeight = roundToNearest10(
      vehicle.tareWeight + randomFloatBetween(-tareVariance, tareVariance)
    );
    // 毛重 = 卸车净重 + 皮重（四舍五入到 10kg）
    const grossWeight = roundToNearest10(unloadingNetWeight + actualTareWeight);

    // 计算轮胎条数
    const avgTireWeight = config.tireWeightKg * randomFloatBetween(0.9, 1.1);
    const calculatedTireCount = Math.round(loadingNetWeight / avgTireWeight);
    const tireCount = Math.max(500, calculatedTireCount);

    globalIndex++;
    incrementVehicleUsage(vehicle.id, workDay);

    transferRecords.push({
      recordNo: generateRecordNo(
        "TR",
        collectionPoint.code,
        globalIndex,
        workDay
      ),
      vehicleId: vehicle.id,
      transferDate: workDay,
      destination: factoryName,
      tireCount,
      loadingNetWeight,
      grossWeight,
      tareWeight: actualTareWeight,
      unloadingNetWeight,
      loss,
      weighbridgeNo: generateWeighbridgeNo(workDay, globalIndex),
    });
  };

  // 按天循环，使用累积分配方式均匀分布车次
  for (let dayIndex = 0; dayIndex < workDays.length; dayIndex++) {
    const workDay = workDays[dayIndex];

    // 计算到当天结束时应该累积分配的车次数
    // 使用 (dayIndex + 1) / workDays.length * totalTripsNeeded
    const targetAllocatedTrips = Math.round(
      ((dayIndex + 1) / workDays.length) * totalTripsNeeded
    );

    // 当天需要分配的车次数
    const dailyTrips = targetAllocatedTrips - allocatedTrips;

    // 生成当天的转移记录
    for (let i = 0; i < dailyTrips; i++) {
      generateTransferRecord(workDay);
      allocatedTrips++;
    }
  }

  return { transferRecords };
}

/**
 * 执行转移台账生成任务
 */
export async function executeTransferTask(
  taskId: string
): Promise<TransferGenerationResult> {
  const task = await prisma.transferTask.findUnique({
    where: { id: taskId },
    include: { factory: { select: { name: true } } },
  });

  if (!task) {
    throw new Error("任务不存在");
  }

  try {
    await prisma.transferTask.update({
      where: { id: taskId },
      data: { status: "PROCESSING", startedAt: new Date() },
    });

    await prisma.transferRecord.deleteMany({ where: { taskId } });

    const { transferRecords } = await generateTransferData(
      task.collectionPointId,
      task.startDate,
      task.endDate,
      task.targetTonnage,
      task.factory?.name ?? "再生资源加工厂"
    );

    // 在保存前调整时间为中国时区
    await prisma.transferRecord.createMany({
      data: transferRecords.map((r) => ({
        ...r,
        taskId,
        transferDate: adjustToChineseTimezone(r.transferDate),
      })),
    });

    const totalLoadingWeight = transferRecords.reduce(
      (sum, r) => sum + r.loadingNetWeight,
      0
    );
    const totalUnloadingWeight = transferRecords.reduce(
      (sum, r) => sum + r.unloadingNetWeight,
      0
    );
    const totalLoss = transferRecords.reduce((sum, r) => sum + r.loss, 0);
    const vehicleIds = new Set(transferRecords.map((r) => r.vehicleId));

    await prisma.transferTask.update({
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
      totalRecords: transferRecords.length,
      totalLoadingWeight: roundToNearest10(totalLoadingWeight),
      totalUnloadingWeight: roundToNearest10(totalUnloadingWeight),
      totalLoss: roundToNearest10(totalLoss),
      vehiclesCount: vehicleIds.size,
    };
  } catch (error) {
    await prisma.transferTask.update({
      where: { id: taskId },
      data: {
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message : "未知错误",
      },
    });
    throw error;
  }
}
