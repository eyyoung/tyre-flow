import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAuth, isAdmin } from '@/lib/auth';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// 获取单个门店
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withAuth(request, async (user) => {
    const { id } = await params;

    try {
      const store = await prisma.store.findUnique({
        where: { id },
        include: {
          collectionPoint: {
            select: { id: true, name: true, code: true },
          },
        },
      });

      if (!store) {
        return NextResponse.json({ message: 'Store not found' }, { status: 404 });
      }

      // 非管理员检查权限
      if (!isAdmin(user)) {
        const binding = await prisma.userCollectionPoint.findUnique({
          where: {
            userId_collectionPointId: {
              userId: user.userId,
              collectionPointId: store.collectionPointId,
            },
          },
        });

        if (!binding) {
          return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
        }
      }

      return NextResponse.json({ data: store });
    } catch (error) {
      console.error('Get store error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

// 更新门店
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
        businessLicense,
        legalPerson,
        address,
        province,
        city,
        district,
        longitude,
        latitude,
        contactName,
        contactPhone,
        status,
        disabledReason,
      } = body;

      const existing = await prisma.store.findUnique({
        where: { id },
      });

      if (!existing) {
        return NextResponse.json({ message: 'Store not found' }, { status: 404 });
      }

      const updateData: Record<string, unknown> = {};
      if (name !== undefined) updateData.name = name;
      if (businessLicense !== undefined)
        updateData.businessLicense = businessLicense || null;
      if (legalPerson !== undefined) updateData.legalPerson = legalPerson || null;
      if (address !== undefined) updateData.address = address;
      if (province !== undefined) updateData.province = province || null;
      if (city !== undefined) updateData.city = city || null;
      if (district !== undefined) updateData.district = district || null;
      if (longitude !== undefined)
        updateData.longitude = longitude ? parseFloat(longitude) : null;
      if (latitude !== undefined)
        updateData.latitude = latitude ? parseFloat(latitude) : null;
      if (contactName !== undefined) updateData.contactName = contactName || null;
      if (contactPhone !== undefined)
        updateData.contactPhone = contactPhone || null;

      // 状态变更处理
      if (status !== undefined && status !== existing.status) {
        updateData.status = status;
        if (status === 'DISABLED') {
          updateData.disabledAt = new Date();
          updateData.disabledReason = disabledReason || null;
        } else {
          updateData.disabledAt = null;
          updateData.disabledReason = null;
        }
      }

      const store = await prisma.store.update({
        where: { id },
        data: updateData,
      });

      return NextResponse.json({ data: store });
    } catch (error) {
      console.error('Update store error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

// 删除门店
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withAuth(request, async (user) => {
    if (!isAdmin(user)) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;

    try {
      const store = await prisma.store.findUnique({
        where: { id },
      });

      if (!store) {
        return NextResponse.json({ message: 'Store not found' }, { status: 404 });
      }

      await prisma.store.delete({
        where: { id },
      });

      return NextResponse.json({ message: 'Store deleted successfully' });
    } catch (error) {
      console.error('Delete store error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

