import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAuth, isAdmin } from '@/lib/auth';

// 获取门店列表
export async function GET(request: NextRequest) {
  return withAuth(request, async (user) => {
    try {
      const { searchParams } = new URL(request.url);
      const page = parseInt(searchParams.get('page') || '1');
      const pageSize = parseInt(searchParams.get('pageSize') || '10');
      const search = searchParams.get('search') || '';
      const status = searchParams.get('status') || '';
      const collectionPointId = searchParams.get('collectionPointId') || '';
      const isVirtual = searchParams.get('isVirtual');
      const sortField = searchParams.get('sortField') || '';
      const sortOrder = searchParams.get('sortOrder') || '';

      // 非管理员只能看到自己绑定的收集点下的门店
      let allowedCollectionPointIds: string[] | null = null;
      if (!isAdmin(user)) {
        const bindings = await prisma.userCollectionPoint.findMany({
          where: { userId: user.userId },
          select: { collectionPointId: true },
        });
        allowedCollectionPointIds = bindings.map((b) => b.collectionPointId);
      }

      const where = {
        AND: [
          search
            ? {
                OR: [
                  { name: { contains: search, mode: 'insensitive' as const } },
                  { code: { contains: search, mode: 'insensitive' as const } },
                  { address: { contains: search, mode: 'insensitive' as const } },
                  { businessLicense: { contains: search, mode: 'insensitive' as const } },
                ],
              }
            : {},
          status ? { status: status as 'ACTIVE' | 'DISABLED' } : {},
          collectionPointId ? { collectionPointId } : {},
          isVirtual !== null && isVirtual !== ''
            ? { isVirtual: isVirtual === 'true' }
            : {},
          allowedCollectionPointIds
            ? { collectionPointId: { in: allowedCollectionPointIds } }
            : {},
        ],
      };

      // 构建排序条件
      type SortableFields = 'estimatedTravelMinutes' | 'createdAt' | 'code' | 'name';
      const allowedSortFields: SortableFields[] = ['estimatedTravelMinutes', 'createdAt', 'code', 'name'];
      let orderBy: { [key in SortableFields]?: 'asc' | 'desc' } = { createdAt: 'desc' };
      
      if (sortField && allowedSortFields.includes(sortField as SortableFields)) {
        orderBy = { [sortField as SortableFields]: sortOrder === 'ascend' ? 'asc' : 'desc' };
      }

      const [total, stores] = await Promise.all([
        prisma.store.count({ where }),
        prisma.store.findMany({
          where,
          include: {
            collectionPoint: {
              select: { id: true, name: true, code: true },
            },
          },
          orderBy,
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      return NextResponse.json({
        data: stores,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      });
    } catch (error) {
      console.error('Get stores error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

// 创建门店
export async function POST(request: NextRequest) {
  return withAuth(request, async (user) => {
    if (!isAdmin(user)) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    try {
      const body = await request.json();
      const {
        code,
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
        collectionPointId,
        isVirtual,
      } = body;

      // 验证必填字段
      if (!code || !name || !address || !collectionPointId) {
        return NextResponse.json(
          { message: 'Code, name, address and collection point are required' },
          { status: 400 }
        );
      }

      // 检查编码是否已存在
      const existing = await prisma.store.findUnique({
        where: { code },
      });

      if (existing) {
        return NextResponse.json(
          { message: 'Store code already exists' },
          { status: 400 }
        );
      }

      // 检查收集点是否存在
      const collectionPoint = await prisma.collectionPoint.findUnique({
        where: { id: collectionPointId },
      });

      if (!collectionPoint) {
        return NextResponse.json(
          { message: 'Collection point not found' },
          { status: 400 }
        );
      }

      const store = await prisma.store.create({
        data: {
          code,
          name,
          businessLicense: businessLicense || null,
          legalPerson: legalPerson || null,
          address,
          province: province || null,
          city: city || null,
          district: district || null,
          longitude: longitude ? parseFloat(longitude) : null,
          latitude: latitude ? parseFloat(latitude) : null,
          contactName: contactName || null,
          contactPhone: contactPhone || null,
          collectionPointId,
          isVirtual: isVirtual ?? false,
        },
      });

      return NextResponse.json({ data: store }, { status: 201 });
    } catch (error) {
      console.error('Create store error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

