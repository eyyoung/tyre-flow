import type { MiddlewareContext } from "@/lib/middleware/types";

type PrismaLike = MiddlewareContext["prisma"];

export interface InventorySummary {
  collectionPointId: string;
  startDate: string;
  endDate: string;
  openingStockWeight: number;
  inboundWeight: number;
  transferredWeight: number;
  availableWeight: number;
}

export interface InventoryParams {
  collectionPointId: string;
  startDate: string;
  endDate: string;
  excludeTransferTaskId?: string;
}

export function parseChinaDayStart(date: string): Date {
  return new Date(`${date}T00:00:00.000+08:00`);
}

export function parseChinaDayEnd(date: string): Date {
  return new Date(`${date}T23:59:59.999+08:00`);
}

export function toDateParam(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildTransferTaskWhere(
  collectionPointId: string,
  excludeTransferTaskId?: string
) {
  return {
    collectionPointId,
    status: "COMPLETED" as const,
    ...(excludeTransferTaskId ? { id: { not: excludeTransferTaskId } } : {}),
  };
}

async function sumCollectionInbound(
  prisma: PrismaLike,
  collectionPointId: string,
  dateFilter: Record<string, Date>
): Promise<number> {
  const result = await prisma.collectionRecord.aggregate({
    where: {
      collectionDate: dateFilter,
      task: {
        collectionPointId,
        status: "COMPLETED",
      },
    },
    _sum: {
      unloadingNetWeight: true,
    },
  });

  return result._sum?.unloadingNetWeight ?? 0;
}

async function sumTransferOutbound(
  prisma: PrismaLike,
  collectionPointId: string,
  dateFilter: Record<string, Date>,
  excludeTransferTaskId?: string
): Promise<number> {
  const result = await prisma.transferRecord.aggregate({
    where: {
      transferDate: dateFilter,
      task: buildTransferTaskWhere(collectionPointId, excludeTransferTaskId),
    },
    _sum: {
      loadingNetWeight: true,
    },
  });

  return result._sum?.loadingNetWeight ?? 0;
}

export async function getInventorySummary(
  prisma: PrismaLike,
  params: InventoryParams
): Promise<InventorySummary> {
  const { collectionPointId, startDate, endDate, excludeTransferTaskId } =
    params;
  const periodStart = parseChinaDayStart(startDate);
  const periodEnd = parseChinaDayEnd(endDate);

  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    throw new Error("日期格式不正确");
  }

  if (periodStart > periodEnd) {
    throw new Error("开始日期不能晚于结束日期");
  }

  const [
    inboundBeforePeriod,
    transferredBeforePeriod,
    inboundWeight,
    transferredWeight,
  ] = await Promise.all([
    sumCollectionInbound(prisma, collectionPointId, { lt: periodStart }),
    sumTransferOutbound(
      prisma,
      collectionPointId,
      { lt: periodStart },
      excludeTransferTaskId
    ),
    sumCollectionInbound(prisma, collectionPointId, {
      gte: periodStart,
      lte: periodEnd,
    }),
    sumTransferOutbound(
      prisma,
      collectionPointId,
      {
        gte: periodStart,
        lte: periodEnd,
      },
      excludeTransferTaskId
    ),
  ]);

  const openingStockWeight = inboundBeforePeriod - transferredBeforePeriod;
  const availableWeight =
    openingStockWeight + inboundWeight - transferredWeight;

  return {
    collectionPointId,
    startDate,
    endDate,
    openingStockWeight,
    inboundWeight,
    transferredWeight,
    availableWeight,
  };
}

export function assertSufficientInventory(
  requestedWeight: number,
  inventory: InventorySummary
): void {
  if (requestedWeight <= 0) {
    throw new Error("目标重量必须大于 0");
  }

  if (requestedWeight > inventory.availableWeight) {
    throw new Error(
      `可转移库存不足：当前可转移 ${(
        inventory.availableWeight / 1000
      ).toFixed(2)} 吨，目标转移 ${(requestedWeight / 1000).toFixed(2)} 吨`
    );
  }
}
