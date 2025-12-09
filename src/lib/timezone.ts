/**
 * 时区转换工具函数
 * 
 * 问题背景：服务器可能运行在 UTC 时区，而业务需要使用中国时区（UTC+8）。
 * 这个模块提供了在存储和显示时进行时区转换的工具函数。
 */

// 中国时区偏移量：UTC+8 = -480 分钟
const CHINA_TIMEZONE_OFFSET = -480;

/**
 * 将本地时间转换为中国时区时间存储
 * 
 * 用于数据生成时：在保存前，将时间调整为"看起来像"中国时间的 UTC 时间。
 * 例如：服务器在 UTC，创建了 06:00 的本地时间，调整后存入数据库，
 * 前端以北京时间显示时就是 06:00。
 */
export function adjustToChineseTimezone(date: Date): Date {
  // 获取服务器本地时区偏移量（分钟）
  // getTimezoneOffset() 返回 UTC - 本地时间的分钟数
  // UTC 时区返回 0，UTC+8 返回 -480
  const localOffset = date.getTimezoneOffset();
  
  // 计算需要调整的时间差（分钟）
  // 如果服务器在 UTC（偏移 0），需要减去 480 分钟（8小时）
  // 如果服务器已经在 UTC+8（偏移 -480），不需要调整
  const adjustment = (localOffset - CHINA_TIMEZONE_OFFSET) * 60 * 1000;
  
  return new Date(date.getTime() - adjustment);
}

/**
 * 将 UTC 时间转换为中国时区时间显示
 * 
 * 用于数据导出时：数据库存储的是调整后的 UTC 时间，
 * 读取时需要加上 8 小时偏移才能正确显示中国时区时间。
 */
export function toChineseTimezone(date: Date): Date {
  // 中国时区 UTC+8
  return new Date(date.getTime() + 8 * 60 * 60 * 1000);
}

/**
 * 格式化日期为 YYYY-MM-DD（中国时区）
 */
export function formatDateCN(date: Date): string {
  const d = toChineseTimezone(date);
  return d.toISOString().slice(0, 10);
}

/**
 * 格式化时间为 HH:MM（中国时区）
 */
export function formatTimeCN(date: Date): string {
  const d = toChineseTimezone(date);
  return d.toISOString().slice(11, 16);
}
