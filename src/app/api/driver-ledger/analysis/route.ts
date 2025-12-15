import { NextRequest, NextResponse } from 'next/server';
import { withMiddlewares, standardMiddlewares } from '@/lib/middleware';
import { formatDateCN } from '@/lib/timezone';

interface TripRecord {
  id: string;
  date: string;
  driverId: string;
  driverName: string;
  loadingTimeMinutes: number;        // 分钟数 (0-1440)
  unloadingTimeMinutes: number | null; // 分钟数 (0-1440)，null 表示中间站点无卸车
  loadingTimeStr: string;            // 格式化的时间字符串 HH:mm
  unloadingTimeStr: string;          // 格式化的时间字符串 HH:mm 或 '-'
  weight: number;
}

// 格式化时间为 HH:mm（中国时区 UTC+8）
function formatTimeWithTimezone(date: Date): string {
  // 使用中国时区格式化
  return date.toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// 获取时间的分钟数（从午夜开始，中国时区）
function getMinutesFromMidnight(date: Date): number {
  const timeStr = date.toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

// 获取司机台账图表数据
export async function GET(request: NextRequest) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    try {
      const { searchParams } = new URL(request.url);
      const collectionPointId = searchParams.get('collectionPointId') || '';
      const recordType = searchParams.get('recordType') || 'collection'; // collection | transfer
      const startDate = searchParams.get('startDate') || '';
      const endDate = searchParams.get('endDate') || '';

      // 验证必填参数
      if (!collectionPointId) {
        return NextResponse.json(
          { error: '请选择收集点' },
          { status: 400 }
        );
      }

      if (!startDate || !endDate) {
        return NextResponse.json(
          { error: '请选择时间段' },
          { status: 400 }
        );
      }

      // 构建日期条件
      // 用户输入的日期代表中国时区（UTC+8）的那一天
      // 使用固定的 +08:00 时区偏移，不依赖服务器时区设置
      const startDateObj = new Date(startDate + 'T00:00:00.000+08:00');
      const endDateObj = new Date(endDate + 'T23:59:59.999+08:00');

      const tripRecords: TripRecord[] = [];
      const driversMap = new Map<string, { name: string; phone: string }>();

      if (recordType === 'collection') {
        // 获取收集记录 - ctx.prisma 已自动带收集点权限过滤
        const records = await ctx.prisma.collectionRecord.findMany({
          where: {
            vehicle: { collectionPointId },
            collectionDate: {
              gte: startDateObj,
              lte: endDateObj,
            },
          },
          include: {
            vehicle: {
              select: {
                id: true,
                plateNumber: true,
                driverName: true,
                driverPhone: true,
              },
            },
          },
          orderBy: { collectionDate: 'asc' },
        });

        for (const record of records) {
          const dateStr = formatDateCN(record.collectionDate);
          const driverId = record.vehicle.id;
          const driverName = record.vehicle.driverName || record.vehicle.plateNumber;
          
          // 记录司机信息
          if (!driversMap.has(driverId)) {
            driversMap.set(driverId, {
              name: driverName,
              phone: record.vehicle.driverPhone || '',
            });
          }

          tripRecords.push({
            id: record.id,
            date: dateStr,
            driverId,
            driverName,
            loadingTimeMinutes: getMinutesFromMidnight(record.loadingTime),
            unloadingTimeMinutes: record.unloadingTime ? getMinutesFromMidnight(record.unloadingTime) : null,
            loadingTimeStr: formatTimeWithTimezone(record.loadingTime),
            unloadingTimeStr: record.unloadingTime ? formatTimeWithTimezone(record.unloadingTime) : '-',
            weight: Math.round(record.loadingNetWeight),
          });
        }
      } else {
        // 获取转移记录 - ctx.prisma 已自动带收集点权限过滤
        const records = await ctx.prisma.transferRecord.findMany({
          where: {
            vehicle: { collectionPointId },
            transferDate: {
              gte: startDateObj,
              lte: endDateObj,
            },
          },
          include: {
            vehicle: {
              select: {
                id: true,
                plateNumber: true,
                driverName: true,
                driverPhone: true,
              },
            },
          },
          orderBy: { transferDate: 'asc' },
        });

        for (const record of records) {
          const dateStr = formatDateCN(record.transferDate);
          const driverId = record.vehicle.id;
          const driverName = record.vehicle.driverName || record.vehicle.plateNumber;
          
          // 记录司机信息
          if (!driversMap.has(driverId)) {
            driversMap.set(driverId, {
              name: driverName,
              phone: record.vehicle.driverPhone || '',
            });
          }

          tripRecords.push({
            id: record.id,
            date: dateStr,
            driverId,
            driverName,
            // TransferRecord 只有 transferDate，用它作为时间参考
            loadingTimeMinutes: getMinutesFromMidnight(record.transferDate),
            unloadingTimeMinutes: null,
            loadingTimeStr: formatTimeWithTimezone(record.transferDate),
            unloadingTimeStr: '-',
            weight: Math.round(record.loadingNetWeight),
          });
        }
      }

      // 按日期和装车时间排序
      tripRecords.sort((a, b) => {
        const dateCompare = a.date.localeCompare(b.date);
        if (dateCompare !== 0) return dateCompare;
        return a.loadingTimeMinutes - b.loadingTimeMinutes;
      });

      // 获取所有司机列表
      const drivers = Array.from(driversMap.entries()).map(([id, info]) => ({
        id,
        name: info.name,
        phone: info.phone,
      }));

      return NextResponse.json({
        data: tripRecords,
        drivers,
        dateRange: {
          start: startDate,
          end: endDate,
        },
      });
    } catch (error) {
      console.error('Error fetching driver analysis:', error);
      return NextResponse.json(
        { error: '获取分析数据失败' },
        { status: 500 }
      );
    }
  });
}
