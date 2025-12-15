import { NextRequest, NextResponse } from 'next/server';
import { withMiddlewares, standardMiddlewares } from '@/lib/middleware';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// 获取单个收集点
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    const { id } = await params;

    try {
      // ctx.prisma 已自动带收集点权限过滤
      // findUnique 会自动检查结果是否在权限范围内
      const collectionPoint = await ctx.prisma.collectionPoint.findUnique({
        where: { id },
        include: {
          _count: {
            select: {
              stores: true,
              vehicles: true,
            },
          },
        },
      });

      if (!collectionPoint) {
        return NextResponse.json(
          { message: 'Collection point not found' },
          { status: 404 }
        );
      }

      return NextResponse.json({ data: collectionPoint });
    } catch (error) {
      console.error('Get collection point error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

// 更新收集点
export async function PUT(request: NextRequest, { params }: RouteParams) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    // 只有管理员可以更新收集点
    if (ctx.user?.role !== 'ADMIN') {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;

    try {
      const body = await request.json();
      const {
        name,
        companyName,
        address,
        province,
        city,
        district,
        postcode,
        longitude,
        latitude,
        certScope,
        contactName,
        contactPhone,
        status,
      } = body;

      // 检查收集点是否存在
      const existing = await ctx.prisma.collectionPoint.findUnique({
        where: { id },
      });

      if (!existing) {
        return NextResponse.json(
          { message: 'Collection point not found' },
          { status: 404 }
        );
      }

      const updateData: Record<string, unknown> = {};
      if (name !== undefined) updateData.name = name;
      if (companyName !== undefined) updateData.companyName = companyName || null;
      if (address !== undefined) updateData.address = address;
      if (province !== undefined) updateData.province = province || null;
      if (city !== undefined) updateData.city = city || null;
      if (district !== undefined) updateData.district = district || null;
      if (postcode !== undefined) updateData.postcode = postcode || null;
      if (longitude !== undefined)
        updateData.longitude = longitude ? parseFloat(longitude) : null;
      if (latitude !== undefined)
        updateData.latitude = latitude ? parseFloat(latitude) : null;
      if (certScope !== undefined) updateData.certScope = certScope || null;
      if (contactName !== undefined)
        updateData.contactName = contactName || null;
      if (contactPhone !== undefined)
        updateData.contactPhone = contactPhone || null;
      if (status !== undefined) updateData.status = status;

      const collectionPoint = await ctx.prisma.collectionPoint.update({
        where: { id },
        data: updateData,
      });

      return NextResponse.json({ data: collectionPoint });
    } catch (error) {
      console.error('Update collection point error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

// 删除收集点
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    // 只有管理员可以删除收集点
    if (ctx.user?.role !== 'ADMIN') {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;

    try {
      const collectionPoint = await ctx.prisma.collectionPoint.findUnique({
        where: { id },
        include: {
          _count: {
            select: {
              stores: true,
              vehicles: true,
            },
          },
        },
      });

      if (!collectionPoint) {
        return NextResponse.json(
          { message: 'Collection point not found' },
          { status: 404 }
        );
      }

      // 级联删除会自动处理关联的门店和车辆
      await ctx.prisma.collectionPoint.delete({
        where: { id },
      });

      return NextResponse.json({ message: 'Collection point deleted successfully' });
    } catch (error) {
      console.error('Delete collection point error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}
