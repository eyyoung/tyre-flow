import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAuth, isAdmin } from '@/lib/auth';

interface ImportVehicle {
  plateNumber: string;
  type: 'COLLECTION' | 'TRANSFER';
  brand: string | null;
  model: string | null;
  tareWeight: number;  // kg
  tareWeightVariance: number;  // kg
  maxLoad: number;  // kg
  driverName: string | null;
  driverPhone: string | null;
}

// 批量导入车辆
export async function POST(request: NextRequest) {
  return withAuth(request, async (user) => {
    if (!isAdmin(user)) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    try {
      const body = await request.json();
      const { collectionPointId, vehicles } = body as {
        collectionPointId: string;
        vehicles: ImportVehicle[];
      };

      // 验证收集点
      if (!collectionPointId) {
        return NextResponse.json(
          { message: 'Collection point ID is required' },
          { status: 400 }
        );
      }

      const collectionPoint = await prisma.collectionPoint.findUnique({
        where: { id: collectionPointId },
      });

      if (!collectionPoint) {
        return NextResponse.json(
          { message: 'Collection point not found' },
          { status: 400 }
        );
      }

      // 验证车辆数据
      if (!vehicles || !Array.isArray(vehicles) || vehicles.length === 0) {
        return NextResponse.json(
          { message: 'No vehicles data provided' },
          { status: 400 }
        );
      }

      // 获取已存在的车牌号（用于去重）
      const existingPlates = await prisma.vehicle.findMany({
        where: {
          plateNumber: { in: vehicles.map(v => v.plateNumber) },
        },
        select: { plateNumber: true },
      });
      const existingPlateSet = new Set(existingPlates.map(v => v.plateNumber));

      let success = 0;
      let failed = 0;
      let skipped = 0;
      const errors: string[] = [];

      // 准备批量创建的数据
      const vehiclesToCreate: Array<{
        plateNumber: string;
        type: 'COLLECTION' | 'TRANSFER';
        brand: string | null;
        model: string | null;
        tareWeight: number;
        tareWeightVariance: number;
        maxLoad: number;
        driverName: string | null;
        driverPhone: string | null;
        collectionPointId: string;
        status: 'ACTIVE' | 'DISABLED';
      }> = [];

      for (let i = 0; i < vehicles.length; i++) {
        const vehicle = vehicles[i];

        // 验证必填字段
        if (!vehicle.plateNumber) {
          errors.push(`Row ${i + 1}: Missing plate number`);
          failed++;
          continue;
        }

        if (vehicle.tareWeight <= 0) {
          errors.push(`Row ${i + 1}: Invalid tare weight`);
          failed++;
          continue;
        }

        if (vehicle.maxLoad <= 0) {
          errors.push(`Row ${i + 1}: Invalid max load`);
          failed++;
          continue;
        }

        // 检查车牌号是否重复
        if (existingPlateSet.has(vehicle.plateNumber)) {
          skipped++;
          continue;
        }

        // 添加到已处理集合，避免本批次重复
        existingPlateSet.add(vehicle.plateNumber);

        vehiclesToCreate.push({
          plateNumber: vehicle.plateNumber,
          type: vehicle.type || 'COLLECTION',
          brand: vehicle.brand || null,
          model: vehicle.model || null,
          tareWeight: vehicle.tareWeight,
          tareWeightVariance: vehicle.tareWeightVariance || 50,  // 默认 50kg
          maxLoad: vehicle.maxLoad,
          driverName: vehicle.driverName || null,
          driverPhone: vehicle.driverPhone || null,
          collectionPointId,
          status: 'ACTIVE',
        });
      }

      // 批量创建车辆
      if (vehiclesToCreate.length > 0) {
        try {
          await prisma.vehicle.createMany({
            data: vehiclesToCreate,
            skipDuplicates: true,
          });
          success = vehiclesToCreate.length;
        } catch (error) {
          console.error('Batch create vehicles error:', error);
          failed = vehiclesToCreate.length;
          errors.push('Batch create failed, please try again');
        }
      }

      return NextResponse.json({
        success,
        failed,
        skipped,
        errors,
        message: `Successfully imported ${success} vehicles`,
      });
    } catch (error) {
      console.error('Import vehicles error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

