import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

// 获取司机列表（从车辆中提取）
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const collectionPointId = searchParams.get('collectionPointId') || '';

    const where: Record<string, unknown> = {
      driverName: { not: null },
    };

    if (collectionPointId) {
      where.collectionPointId = collectionPointId;
    }

    const vehicles = await prisma.vehicle.findMany({
      where,
      select: {
        id: true,
        plateNumber: true,
        driverName: true,
        driverPhone: true,
        type: true,
        collectionPoint: {
          select: { name: true },
        },
      },
      orderBy: { driverName: 'asc' },
    });

    // 按司机去重（一个司机可能有多辆车）
    const driverMap = new Map<string, {
      id: string;
      vehicleId: string;
      name: string;
      phone: string;
      vehicles: Array<{ plateNumber: string; type: string }>;
      collectionPointName: string;
    }>();

    for (const v of vehicles) {
      const key = `${v.driverName}-${v.driverPhone}`;
      if (!driverMap.has(key)) {
        driverMap.set(key, {
          id: v.id,
          vehicleId: v.id,
          name: v.driverName || '',
          phone: v.driverPhone || '',
          vehicles: [],
          collectionPointName: v.collectionPoint.name,
        });
      }
      driverMap.get(key)!.vehicles.push({
        plateNumber: v.plateNumber,
        type: v.type,
      });
    }

    const drivers = Array.from(driverMap.values());

    return NextResponse.json({ data: drivers });
  } catch (error) {
    console.error('Error fetching drivers:', error);
    return NextResponse.json(
      { error: '获取司机列表失败' },
      { status: 500 }
    );
  }
}

