import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAuth, isAdmin } from '@/lib/auth';

// 获取收集点列表
export async function GET(request: NextRequest) {
  return withAuth(request, async (user) => {
    try {
      const { searchParams } = new URL(request.url);
      const page = parseInt(searchParams.get('page') || '1');
      const pageSize = parseInt(searchParams.get('pageSize') || '10');
      const search = searchParams.get('search') || '';
      const status = searchParams.get('status') || '';
      const all = searchParams.get('all') === 'true'; // 获取所有（用于下拉选择）

      // 非管理员只能看到自己绑定的收集点
      const userBindings = isAdmin(user)
        ? null
        : await prisma.userCollectionPoint.findMany({
            where: { userId: user.userId },
            select: { collectionPointId: true },
          });

      const where = {
        AND: [
          search
            ? {
                OR: [
                  { name: { contains: search, mode: 'insensitive' as const } },
                  { code: { contains: search, mode: 'insensitive' as const } },
                  { address: { contains: search, mode: 'insensitive' as const } },
                ],
              }
            : {},
          status ? { status: status as 'ACTIVE' | 'DISABLED' } : {},
          userBindings
            ? { id: { in: userBindings.map((b) => b.collectionPointId) } }
            : {},
        ],
      };

      if (all) {
        // 返回所有收集点（用于下拉选择）
        const collectionPoints = await prisma.collectionPoint.findMany({
          where,
          select: {
            id: true,
            code: true,
            name: true,
            status: true,
          },
          orderBy: { code: 'asc' },
        });

        return NextResponse.json({ data: collectionPoints });
      }

      const [total, collectionPoints] = await Promise.all([
        prisma.collectionPoint.count({ where }),
        prisma.collectionPoint.findMany({
          where,
          include: {
            _count: {
              select: {
                stores: true,
                vehicles: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      return NextResponse.json({
        data: collectionPoints,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      });
    } catch (error) {
      console.error('Get collection points error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

// 创建收集点
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
      } = body;

      // 验证必填字段
      if (!code || !name || !address) {
        return NextResponse.json(
          { message: 'Code, name and address are required' },
          { status: 400 }
        );
      }

      // 检查编码是否已存在
      const existing = await prisma.collectionPoint.findUnique({
        where: { code },
      });

      if (existing) {
        return NextResponse.json(
          { message: 'Collection point code already exists' },
          { status: 400 }
        );
      }

      const collectionPoint = await prisma.collectionPoint.create({
        data: {
          code,
          name,
          companyName: companyName || null,
          address,
          province: province || null,
          city: city || null,
          district: district || null,
          postcode: postcode || null,
          longitude: longitude ? parseFloat(longitude) : null,
          latitude: latitude ? parseFloat(latitude) : null,
          certScope: certScope || null,
          contactName: contactName || null,
          contactPhone: contactPhone || null,
        },
      });

      return NextResponse.json({ data: collectionPoint }, { status: 201 });
    } catch (error) {
      console.error('Create collection point error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

