import dayjs from "dayjs";

/**
 * 计算 ISCC 签署日期
 * 优先级：1. 缓存的签署日期 -> 2. 第一次收集日期 -> 3. 随机生成（导入时间前15-45天）
 * @returns { signDate: Date, isNewlyCalculated: boolean }
 */
export function calculateSignDate(
  cachedSignDate: Date | null | undefined,
  firstCollectionDate: Date | null | undefined,
  storeCreatedAt: Date
): { signDate: Date; isNewlyCalculated: boolean } {
  // 1. 优先使用缓存的签署日期
  if (cachedSignDate) {
    return { signDate: cachedSignDate, isNewlyCalculated: false };
  }

  // 2. 使用第一次收集日期
  if (firstCollectionDate) {
    return { signDate: firstCollectionDate, isNewlyCalculated: true };
  }

  // 3. 随机生成：导入时间往前15天到45天（半个月到一个半月）
  const daysBack = Math.floor(Math.random() * 31) + 15; // 15-45天
  const signDate = dayjs(storeCreatedAt).subtract(daysBack, "day").toDate();
  return { signDate, isNewlyCalculated: true };
}

