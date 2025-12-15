import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withMiddlewares, authOnlyMiddlewares } from '@/lib/middleware';
import { hashPassword } from '@/lib/auth';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// 获取单个用户
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withMiddlewares(request, authOnlyMiddlewares, async (ctx) => {
    const { id } = await params;

    // 非管理员只能查看自己
    if (ctx.user?.role !== 'ADMIN' && ctx.user?.userId !== id) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    try {
      const user = await prisma.user.findUnique({
        where: { id },
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
      });

      if (!user) {
        return NextResponse.json({ message: 'User not found' }, { status: 404 });
      }

      return NextResponse.json({ data: user });
    } catch (error) {
      console.error('Get user error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

// 更新用户
export async function PUT(request: NextRequest, { params }: RouteParams) {
  return withMiddlewares(request, authOnlyMiddlewares, async (ctx) => {
    const { id } = await params;

    // 非管理员只能更新自己的基本信息
    if (ctx.user?.role !== 'ADMIN' && ctx.user?.userId !== id) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    try {
      const body = await request.json();
      const { email, name, role, status, password, collectionPointIds } = body;

      // 检查用户是否存在
      const existingUser = await prisma.user.findUnique({
        where: { id },
      });

      if (!existingUser) {
        return NextResponse.json({ message: 'User not found' }, { status: 404 });
      }

      // 非管理员不能修改角色和状态
      if (ctx.user?.role !== 'ADMIN') {
        if (role !== undefined || status !== undefined) {
          return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
        }
      }

      // 检查邮箱是否已被其他用户使用
      if (email && email !== existingUser.email) {
        const emailExists = await prisma.user.findFirst({
          where: { email, id: { not: id } },
        });

        if (emailExists) {
          return NextResponse.json(
            { message: 'Email already exists' },
            { status: 400 }
          );
        }
      }

      // 准备更新数据
      const updateData: Record<string, unknown> = {};
      if (email !== undefined) updateData.email = email || null;
      if (name !== undefined) updateData.name = name || null;
      if (ctx.user?.role === 'ADMIN') {
        if (role !== undefined) updateData.role = role;
        if (status !== undefined) updateData.status = status;
      }
      if (password) {
        updateData.password = await hashPassword(password);
      }

      // 更新用户
      const updatedUser = await prisma.user.update({
        where: { id },
        data: updateData,
        select: {
          id: true,
          username: true,
          email: true,
          name: true,
          role: true,
          status: true,
          updatedAt: true,
        },
      });

      // 如果是管理员且提供了收集点列表，更新绑定关系
      if (ctx.user?.role === 'ADMIN' && collectionPointIds !== undefined) {
        // 删除现有绑定
        await prisma.userCollectionPoint.deleteMany({
          where: { userId: id },
        });

        // 创建新绑定
        if (collectionPointIds.length > 0) {
          await prisma.userCollectionPoint.createMany({
            data: collectionPointIds.map((cpId: string) => ({
              userId: id,
              collectionPointId: cpId,
            })),
          });
        }
      }

      return NextResponse.json({ data: updatedUser });
    } catch (error) {
      console.error('Update user error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

// 删除用户
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withMiddlewares(request, authOnlyMiddlewares, async (ctx) => {
    // 只有管理员可以删除用户
    if (ctx.user?.role !== 'ADMIN') {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;

    // 不能删除自己
    if (ctx.user?.userId === id) {
      return NextResponse.json(
        { message: 'Cannot delete yourself' },
        { status: 400 }
      );
    }

    try {
      const user = await prisma.user.findUnique({
        where: { id },
      });

      if (!user) {
        return NextResponse.json({ message: 'User not found' }, { status: 404 });
      }

      await prisma.user.delete({
        where: { id },
      });

      return NextResponse.json({ message: 'User deleted successfully' });
    } catch (error) {
      console.error('Delete user error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}
