import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

interface ChartDataPoint {
  date: string;
  driverId: string;
  driverName: string;
  weight: number;
  loadingTime: string;  // 最早装车时间
  unloadingTime: string; // 最晚卸车时间
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

// 获取司机台账图表数据
export async function GET(request: NextRequest) {
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
    const startDateObj = new Date(startDate);
    const endDateObj = new Date(endDate);
    endDateObj.setHours(23, 59, 59, 999);

    const chartData: ChartDataPoint[] = [];
    const driversMap = new Map<string, { name: string; phone: string }>();

    if (recordType === 'collection') {
      // 获取收集记录
      const records = await prisma.collectionRecord.findMany({
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

      // 按日期和司机聚合数据
      const aggregated = new Map<string, { 
        weight: number; 
        loadingTime: Date; 
        unloadingTime: Date;
      }>();
      
      for (const record of records) {
        const dateStr = record.collectionDate.toISOString().slice(0, 10);
        const driverId = record.vehicle.id;
        const key = `${dateStr}_${driverId}`;
        
        // 累加装车净重（已经是 kg）
        const existing = aggregated.get(key);
        
        if (existing) {
          existing.weight += record.loadingNetWeight;
          // 更新最早装车时间和最晚卸车时间
          if (record.loadingTime < existing.loadingTime) {
            existing.loadingTime = record.loadingTime;
          }
          if (record.unloadingTime > existing.unloadingTime) {
            existing.unloadingTime = record.unloadingTime;
          }
        } else {
          aggregated.set(key, {
            weight: record.loadingNetWeight,
            loadingTime: record.loadingTime,
            unloadingTime: record.unloadingTime,
          });
        }
        
        // 记录司机信息
        if (!driversMap.has(driverId)) {
          driversMap.set(driverId, {
            name: record.vehicle.driverName || record.vehicle.plateNumber,
            phone: record.vehicle.driverPhone || '',
          });
        }
      }

      // 转换为图表数据
      for (const [key, data] of aggregated) {
        const [date, driverId] = key.split('_');
        const driver = driversMap.get(driverId);
        chartData.push({
          date,
          driverId,
          driverName: driver ? `${driver.name}` : driverId,
          weight: Math.round(data.weight),
          loadingTime: formatTimeWithTimezone(data.loadingTime),
          unloadingTime: formatTimeWithTimezone(data.unloadingTime),
        });
      }
    } else {
      // 获取转移记录
      const records = await prisma.transferRecord.findMany({
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

      // 按日期和司机聚合数据
      const aggregated = new Map<string, { 
        weight: number; 
        loadingTime: Date; 
        unloadingTime: Date;
      }>();
      
      for (const record of records) {
        const dateStr = record.transferDate.toISOString().slice(0, 10);
        const driverId = record.vehicle.id;
        const key = `${dateStr}_${driverId}`;
        
        // 累加装车净重
        const existing = aggregated.get(key);
        
        if (existing) {
          existing.weight += record.loadingNetWeight;
          // 更新最早装车时间和最晚卸车时间
          if (record.loadingTime < existing.loadingTime) {
            existing.loadingTime = record.loadingTime;
          }
          if (record.unloadingTime > existing.unloadingTime) {
            existing.unloadingTime = record.unloadingTime;
          }
        } else {
          aggregated.set(key, {
            weight: record.loadingNetWeight,
            loadingTime: record.loadingTime,
            unloadingTime: record.unloadingTime,
          });
        }
        
        // 记录司机信息
        if (!driversMap.has(driverId)) {
          driversMap.set(driverId, {
            name: record.vehicle.driverName || record.vehicle.plateNumber,
            phone: record.vehicle.driverPhone || '',
          });
        }
      }

      // 转换为图表数据
      for (const [key, data] of aggregated) {
        const [date, driverId] = key.split('_');
        const driver = driversMap.get(driverId);
        chartData.push({
          date,
          driverId,
          driverName: driver ? `${driver.name}` : driverId,
          weight: Math.round(data.weight),
          loadingTime: formatTimeWithTimezone(data.loadingTime),
          unloadingTime: formatTimeWithTimezone(data.unloadingTime),
        });
      }
    }

    // 按日期排序
    chartData.sort((a, b) => a.date.localeCompare(b.date));

    // 获取所有司机列表
    const drivers = Array.from(driversMap.entries()).map(([id, info]) => ({
      id,
      name: info.name,
      phone: info.phone,
    }));

    return NextResponse.json({
      data: chartData,
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
}

