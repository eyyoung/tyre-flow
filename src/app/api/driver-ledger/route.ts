import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

// 获取司机台账记录
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');
    const driverId = searchParams.get('driverId') || '';
    const collectionPointId = searchParams.get('collectionPointId') || '';
    const recordType = searchParams.get('recordType') || 'all'; // all | collection | transfer
    const startDate = searchParams.get('startDate') || '';
    const endDate = searchParams.get('endDate') || '';

    // 构建日期条件
    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (startDate) {
      dateFilter.gte = new Date(startDate);
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }

    // 获取收集记录
    let collectionRecords: Array<{
      id: string;
      recordNo: string;
      date: Date;
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

      const records = await prisma.collectionRecord.findMany({
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
        type: 'collection' as const,
        driverName: r.vehicle.driverName || '',
        driverPhone: r.vehicle.driverPhone || '',
        vehiclePlate: r.vehicle.plateNumber,
        weight: r.weight,
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

      const records = await prisma.transferRecord.findMany({
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
        type: 'transfer' as const,
        driverName: r.vehicle.driverName || '',
        driverPhone: r.vehicle.driverPhone || '',
        vehiclePlate: r.vehicle.plateNumber,
        weight: r.netWeight,
        tireCount: r.tireCount,
        storeName: null,
        destination: r.destination,
      }));
    }

    // 合并并排序
    const allRecords = [...collectionRecords, ...transferRecords]
      .sort((a, b) => b.date.getTime() - a.date.getTime());

    // 分页
    const total = allRecords.length;
    const paginatedRecords = allRecords.slice((page - 1) * pageSize, page * pageSize);

    // 统计
    const totalTrips = allRecords.length;
    const totalWeight = allRecords.reduce((sum, r) => sum + r.weight, 0);

    return NextResponse.json({
      data: paginatedRecords,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      summary: {
        totalTrips,
        totalWeight: parseFloat(totalWeight.toFixed(3)),
      },
    });
  } catch (error) {
    console.error('Error fetching driver ledger:', error);
    return NextResponse.json(
      { error: '获取司机台账失败' },
      { status: 500 }
    );
  }
}

