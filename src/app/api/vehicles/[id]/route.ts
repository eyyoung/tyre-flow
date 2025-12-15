import { NextRequest, NextResponse } from 'next/server';
import { withMiddlewares, standardMiddlewares } from '@/lib/middleware';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// 获取单个车辆
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    const { id } = await params;

    try {
      // ctx.prisma 已自动带收集点权限过滤
      // findUnique 会自动检查结果是否在权限范围内
      const vehicle = await ctx.prisma.vehicle.findUnique({
        where: { id },
        include: {
          collectionPoint: {
            select: { id: true, name: true, code: true },
          },
        },
      });

      if (!vehicle) {
        return NextResponse.json({ message: 'Vehicle not found' }, { status: 404 });
      }

      return NextResponse.json({ data: vehicle });
    } catch (error) {
      console.error('Get vehicle error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

// 更新车辆
export async function PUT(request: NextRequest, { params }: RouteParams) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    // 只有管理员可以更新车辆
    if (ctx.user?.role !== 'ADMIN') {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;

    try {
      const body = await request.json();
      const {
        type,
        brand,
        model,
        tareWeight,
        tareWeightVariance,
        maxLoad,
        driverName,
        driverPhone,
        status,
      } = body;

      const existing = await ctx.prisma.vehicle.findUnique({
        where: { id },
      });

      if (!existing) {
        return NextResponse.json({ message: 'Vehicle not found' }, { status: 404 });
      }

      const updateData: Record<string, unknown> = {};
      if (type !== undefined) updateData.type = type;
      if (brand !== undefined) updateData.brand = brand || null;
      if (model !== undefined) updateData.model = model || null;
      if (tareWeight !== undefined) updateData.tareWeight = parseFloat(tareWeight);
      if (tareWeightVariance !== undefined)
        updateData.tareWeightVariance = parseFloat(tareWeightVariance);
      if (maxLoad !== undefined) updateData.maxLoad = parseFloat(maxLoad);
      if (driverName !== undefined) updateData.driverName = driverName || null;
      if (driverPhone !== undefined) updateData.driverPhone = driverPhone || null;
      if (status !== undefined) updateData.status = status;

      const vehicle = await ctx.prisma.vehicle.update({
        where: { id },
        data: updateData,
      });

      return NextResponse.json({ data: vehicle });
    } catch (error) {
      console.error('Update vehicle error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

// 删除车辆
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    // 只有管理员可以删除车辆
    if (ctx.user?.role !== 'ADMIN') {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;

    try {
      const vehicle = await ctx.prisma.vehicle.findUnique({
        where: { id },
      });

      if (!vehicle) {
        return NextResponse.json({ message: 'Vehicle not found' }, { status: 404 });
      }

      await ctx.prisma.vehicle.delete({
        where: { id },
      });

      return NextResponse.json({ message: 'Vehicle deleted successfully' });
    } catch (error) {
      console.error('Delete vehicle error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}
