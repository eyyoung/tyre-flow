import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAuth, isAdmin, hashPassword } from '@/lib/auth';

// 获取用户列表
export async function GET(request: NextRequest) {
  return withAuth(request, async (user) => {
    if (!isAdmin(user)) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    try {
      const { searchParams } = new URL(request.url);
      const page = parseInt(searchParams.get('page') || '1');
      const pageSize = parseInt(searchParams.get('pageSize') || '10');
      const search = searchParams.get('search') || '';
      const status = searchParams.get('status') || '';
      const role = searchParams.get('role') || '';

      const where = {
        AND: [
          search
            ? {
                OR: [
                  { username: { contains: search, mode: 'insensitive' as const } },
                  { name: { contains: search, mode: 'insensitive' as const } },
                  { email: { contains: search, mode: 'insensitive' as const } },
                ],
              }
            : {},
          status ? { status: status as 'ACTIVE' | 'DISABLED' } : {},
          role ? { role: role as 'ADMIN' | 'USER' } : {},
        ],
      };

      const [total, users] = await Promise.all([
        prisma.user.count({ where }),
        prisma.user.findMany({
          where,
          select: {
            id: true,
            username: true,
            email: true,
            name: true,
            role: true,
            status: true,
            lastLoginAt: true,
            createdAt: true,
            updatedAt: true,
            collectionPoints: {
              include: {
                collectionPoint: {
                  select: { id: true, name: true, code: true },
                },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      return NextResponse.json({
        data: users,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      });
    } catch (error) {
      console.error('Get users error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

// 创建用户
export async function POST(request: NextRequest) {
  return withAuth(request, async (user) => {
    if (!isAdmin(user)) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    try {
      const body = await request.json();
      const { username, password, email, name, role, collectionPointIds } = body;

      // 验证必填字段
      if (!username || !password) {
        return NextResponse.json(
          { message: 'Username and password are required' },
          { status: 400 }
        );
      }

      // 检查用户名是否已存在
      const existingUser = await prisma.user.findUnique({
        where: { username },
      });

      if (existingUser) {
        return NextResponse.json(
          { message: 'Username already exists' },
          { status: 400 }
        );
      }

      // 检查邮箱是否已存在
      if (email) {
        const existingEmail = await prisma.user.findUnique({
          where: { email },
        });

        if (existingEmail) {
          return NextResponse.json(
            { message: 'Email already exists' },
            { status: 400 }
          );
        }
      }

      // 加密密码
      const hashedPassword = await hashPassword(password);

      // 创建用户
      const newUser = await prisma.user.create({
        data: {
          username,
          password: hashedPassword,
          email: email || null,
          name: name || null,
          role: role || 'USER',
          collectionPoints: collectionPointIds?.length
            ? {
                create: collectionPointIds.map((cpId: string) => ({
                  collectionPointId: cpId,
                })),
              }
            : undefined,
        },
        select: {
          id: true,
          username: true,
          email: true,
          name: true,
          role: true,
          status: true,
          createdAt: true,
        },
      });

      return NextResponse.json({ data: newUser }, { status: 201 });
    } catch (error) {
      console.error('Create user error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

