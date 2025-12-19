import { NextRequest, NextResponse } from 'next/server';
import { withMiddlewares, standardMiddlewares } from '@/lib/middleware';

// 获取车辆列表
export async function GET(request: NextRequest) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    try {
      const { searchParams } = new URL(request.url);
      const page = parseInt(searchParams.get('page') || '1');
      const pageSize = parseInt(searchParams.get('pageSize') || '10');
      const search = searchParams.get('search') || '';
      const status = searchParams.get('status') || '';
      const type = searchParams.get('type') || '';
      const collectionPointId = searchParams.get('collectionPointId') || '';

      // ctx.prisma 已自动带收集点权限过滤，无需手动检查
      const where = {
        AND: [
          search
            ? {
                OR: [
                  { plateNumber: { contains: search, mode: 'insensitive' as const } },
                  { brand: { contains: search, mode: 'insensitive' as const } },
                  { driverName: { contains: search, mode: 'insensitive' as const } },
                ],
              }
            : {},
          status ? { status: status as 'ACTIVE' | 'DISABLED' } : {},
          type ? { type: type as 'COLLECTION' | 'TRANSFER' } : {},
          collectionPointId ? { collectionPointId } : {},
        ],
      };

      const [total, vehicles] = await Promise.all([
        ctx.prisma.vehicle.count({ where }),
        ctx.prisma.vehicle.findMany({
          where,
          include: {
            collectionPoint: {
              select: { id: true, name: true, code: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      return NextResponse.json({
        data: vehicles,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      });
    } catch (error) {
      console.error('Get vehicles error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

// 创建车辆
export async function POST(request: NextRequest) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    // 只有管理员可以创建车辆
    if (ctx.user?.role !== 'ADMIN') {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    try {
      const body = await request.json();
      const {
        plateNumber,
        type,
        brand,
        model,
        tareWeight,
        tareWeightVariance,
        maxLoad,
        driverName,
        driverNameTranslations,
        driverPhone,
        collectionPointId,
      } = body;

      // 验证必填字段
      if (!plateNumber || !type || !tareWeight || !maxLoad || !collectionPointId) {
        return NextResponse.json(
          { message: 'Plate number, type, tare weight, max load and collection point are required' },
          { status: 400 }
        );
      }

      // 检查车牌号是否已存在
      const existing = await ctx.prisma.vehicle.findUnique({
        where: { plateNumber },
      });

      if (existing) {
        return NextResponse.json(
          { message: 'Plate number already exists' },
          { status: 400 }
        );
      }

      // 检查收集点是否存在
      const collectionPoint = await ctx.prisma.collectionPoint.findUnique({
        where: { id: collectionPointId },
      });

      if (!collectionPoint) {
        return NextResponse.json(
          { message: 'Collection point not found' },
          { status: 400 }
        );
      }

      const vehicle = await ctx.prisma.vehicle.create({
        data: {
          plateNumber,
          type,
          brand: brand || null,
          model: model || null,
          tareWeight: parseFloat(tareWeight),
          tareWeightVariance: tareWeightVariance ? parseFloat(tareWeightVariance) : 0.05,
          maxLoad: parseFloat(maxLoad),
          driverName: driverName || null,
          driverNameTranslations: driverNameTranslations || null,
          driverPhone: driverPhone || null,
          collectionPointId,
        },
      });

      return NextResponse.json({ data: vehicle }, { status: 201 });
    } catch (error) {
      console.error('Create vehicle error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}
