import { NextRequest, NextResponse } from 'next/server';
import { withMiddlewares, standardMiddlewares } from '@/lib/middleware';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// 获取单个门店
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    const { id } = await params;

    try {
      // ctx.prisma 已自动带收集点权限过滤
      // findUnique 会自动检查结果是否在权限范围内
      const store = await ctx.prisma.store.findUnique({
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
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    // 只有管理员可以更新门店
    if (ctx.user?.role !== 'ADMIN') {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;

    try {
      const body = await request.json();
      const {
        name,
        nameTranslations,
        businessLicense,
        legalPerson,
        legalPersonTranslations,
        address,
        addressTranslations,
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

      const existing = await ctx.prisma.store.findUnique({
        where: { id },
      });

      if (!existing) {
        return NextResponse.json({ message: 'Store not found' }, { status: 404 });
      }

      const updateData: Record<string, unknown> = {};
      if (name !== undefined) updateData.name = name;
      if (nameTranslations !== undefined) updateData.nameTranslations = nameTranslations;
      if (businessLicense !== undefined)
        updateData.businessLicense = businessLicense || null;
      if (legalPerson !== undefined) updateData.legalPerson = legalPerson || null;
      if (legalPersonTranslations !== undefined) updateData.legalPersonTranslations = legalPersonTranslations;
      if (address !== undefined) updateData.address = address;
      if (addressTranslations !== undefined) updateData.addressTranslations = addressTranslations;
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

      // 如果法人姓名发生变化，使签名缓存失效
      const newLegalPerson = legalPerson !== undefined ? (legalPerson || null) : existing.legalPerson;
      if (newLegalPerson !== existing.legalPerson && existing.signatureFileId) {
        // 删除旧的签名文件并断开关联
        updateData.signatureFileId = null;
        // 异步删除签名文件（不阻塞主流程）
        ctx.prisma.signatureFile.delete({
          where: { id: existing.signatureFileId },
        }).catch((err: unknown) => {
          console.error('Failed to delete old signature file:', err);
        });
        console.log(`[Signature Cache] Invalidated for store ${id} due to legalPerson change`);
      }

      const store = await ctx.prisma.store.update({
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
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    // 只有管理员可以删除门店
    if (ctx.user?.role !== 'ADMIN') {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;

    try {
      const store = await ctx.prisma.store.findUnique({
        where: { id },
      });

      if (!store) {
        return NextResponse.json({ message: 'Store not found' }, { status: 404 });
      }

      await ctx.prisma.store.delete({
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
