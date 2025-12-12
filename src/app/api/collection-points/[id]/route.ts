import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAuth, isAdmin } from '@/lib/auth';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// 获取单个收集点
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withAuth(request, async (user) => {
    const { id } = await params;

    try {
      // 非管理员检查是否有权限访问
      if (!isAdmin(user)) {
        const binding = await prisma.userCollectionPoint.findUnique({
          where: {
            userId_collectionPointId: {
              userId: user.userId,
              collectionPointId: id,
            },
          },
        });

        if (!binding) {
          return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
        }
      }

      const collectionPoint = await prisma.collectionPoint.findUnique({
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
  return withAuth(request, async (user) => {
    if (!isAdmin(user)) {
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
      const existing = await prisma.collectionPoint.findUnique({
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

      const collectionPoint = await prisma.collectionPoint.update({
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
  return withAuth(request, async (user) => {
    if (!isAdmin(user)) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;

    try {
      const collectionPoint = await prisma.collectionPoint.findUnique({
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
      await prisma.collectionPoint.delete({
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

