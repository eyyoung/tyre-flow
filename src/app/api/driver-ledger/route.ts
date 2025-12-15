import { NextRequest, NextResponse } from 'next/server';
import { withMiddlewares, standardMiddlewares } from '@/lib/middleware';

// 获取司机台账记录
export async function GET(request: NextRequest) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    try {
      const { searchParams } = new URL(request.url);
      const page = parseInt(searchParams.get('page') || '1');
      const pageSize = parseInt(searchParams.get('pageSize') || '20');
      const driverId = searchParams.get('driverId') || '';
      const collectionPointId = searchParams.get('collectionPointId') || '';
      const recordType = searchParams.get('recordType') || 'all'; // all | collection | transfer
      const startDate = searchParams.get('startDate') || '';
      const endDate = searchParams.get('endDate') || '';
      const sortField = searchParams.get('sortField') || 'date'; // date | recordNo
      const sortOrder = searchParams.get('sortOrder') || 'desc'; // asc | desc

      // 构建日期条件
      // 用户输入的日期代表中国时区（UTC+8）的那一天
      // 使用固定的 +08:00 时区偏移，不依赖服务器时区设置
      const dateFilter: { gte?: Date; lte?: Date } = {};
      if (startDate) {
        // startDate 格式为 YYYY-MM-DD，代表中国时区的那一天的开始
        // 中国时区 YYYY-MM-DD 00:00:00 -> 自动转换为 UTC
        dateFilter.gte = new Date(startDate + 'T00:00:00.000+08:00');
      }
      if (endDate) {
        // endDate 格式为 YYYY-MM-DD，代表中国时区的那一天的结束
        // 中国时区 YYYY-MM-DD 23:59:59.999 -> 自动转换为 UTC
        dateFilter.lte = new Date(endDate + 'T23:59:59.999+08:00');
      }

      // 获取收集记录
      let collectionRecords: Array<{
        id: string;
        recordNo: string;
        date: Date;
        loadingTime: Date;
        unloadingTime: Date | null;
        type: 'collection';
        driverName: string;
        driverPhone: string;
        vehiclePlate: string;
        weight: number;
        tireCount: number;
        storeName: string | null;
        destination: string | null;
      }> = [];
      
      if (recordType === 'all' || recordType === 'collection') {
        const collectionWhere: Record<string, unknown> = {};
        
        if (driverId) {
          collectionWhere.vehicleId = driverId;
        }
        
        if (collectionPointId) {
          collectionWhere.vehicle = { collectionPointId };
        }
        
        if (Object.keys(dateFilter).length > 0) {
          collectionWhere.collectionDate = dateFilter;
        }

        // ctx.prisma 已自动带收集点权限过滤
        const records = await ctx.prisma.collectionRecord.findMany({
          where: collectionWhere,
          include: {
            vehicle: { select: { id: true, plateNumber: true, driverName: true, driverPhone: true, collectionPointId: true } },
            store: { select: { name: true } },
          },
          orderBy: { collectionDate: 'desc' },
        });

        collectionRecords = records.map(r => ({
          id: r.id,
          recordNo: r.recordNo,
          date: r.collectionDate,
          loadingTime: r.loadingTime,
          unloadingTime: r.unloadingTime,
          type: 'collection' as const,
          driverName: r.vehicle.driverName || '',
          driverPhone: r.vehicle.driverPhone || '',
          vehiclePlate: r.vehicle.plateNumber,
          weight: r.unloadingNetWeight,
          tireCount: r.tireCount,
          storeName: r.store.name,
          destination: null,
        }));
      }

      // 获取转移记录
      let transferRecords: Array<{
        id: string;
        recordNo: string;
        date: Date;
        loadingTime: Date;
        unloadingTime: Date | null;
        type: 'transfer';
        driverName: string;
        driverPhone: string;
        vehiclePlate: string;
        weight: number;
        tireCount: number;
        storeName: string | null;
        destination: string | null;
      }> = [];
      
      if (recordType === 'all' || recordType === 'transfer') {
        const transferWhere: Record<string, unknown> = {};
        
        if (driverId) {
          transferWhere.vehicleId = driverId;
        }
        
        if (collectionPointId) {
          transferWhere.vehicle = { collectionPointId };
        }
        
        if (Object.keys(dateFilter).length > 0) {
          transferWhere.transferDate = dateFilter;
        }

        // ctx.prisma 已自动带收集点权限过滤
        const records = await ctx.prisma.transferRecord.findMany({
          where: transferWhere,
          include: {
            vehicle: { select: { id: true, plateNumber: true, driverName: true, driverPhone: true, collectionPointId: true } },
          },
          orderBy: { transferDate: 'desc' },
        });

        transferRecords = records.map(r => ({
          id: r.id,
          recordNo: r.recordNo,
          date: r.transferDate,
          // TransferRecord 只有 transferDate，用它作为时间参考
          loadingTime: r.transferDate,
          unloadingTime: null,
          type: 'transfer' as const,
          driverName: r.vehicle.driverName || '',
          driverPhone: r.vehicle.driverPhone || '',
          vehiclePlate: r.vehicle.plateNumber,
          weight: r.unloadingNetWeight,
          tireCount: r.tireCount,
          storeName: null,
          destination: r.destination,
        }));
      }

      // 合并并排序
      const allRecords = [...collectionRecords, ...transferRecords]
        .sort((a, b) => {
          if (sortField === 'recordNo') {
            const comparison = a.recordNo.localeCompare(b.recordNo);
            return sortOrder === 'asc' ? comparison : -comparison;
          }
          // 默认按日期排序
          const comparison = a.date.getTime() - b.date.getTime();
          return sortOrder === 'asc' ? comparison : -comparison;
        });

      // 分页
      const total = allRecords.length;
      const paginatedRecords = allRecords.slice((page - 1) * pageSize, page * pageSize);

      // 统计 (weight 现在是 kg)
      const totalTrips = allRecords.length;
      const totalWeightKg = allRecords.reduce((sum, r) => sum + r.weight, 0);

      return NextResponse.json({
        data: paginatedRecords,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
        summary: {
          totalTrips,
          totalWeight: parseFloat((totalWeightKg / 1000).toFixed(2)), // 转换为吨显示
        },
      });
    } catch (error) {
      console.error('Error fetching driver ledger:', error);
      return NextResponse.json(
        { error: '获取司机台账失败' },
        { status: 500 }
      );
    }
  });
}
