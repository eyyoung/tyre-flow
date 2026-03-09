import { NextRequest, NextResponse } from 'next/server';
import { withMiddlewares, authMiddleware } from '@/lib/middleware';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  return withMiddlewares(request, [authMiddleware], async (ctx) => {
    if (ctx.user?.role !== 'ADMIN') {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;

    try {
      const body = await request.json();
      const { name, status } = body;

      const existing = await ctx.prisma.factory.findUnique({ where: { id } });
      if (!existing) {
        return NextResponse.json(
          { message: 'Factory not found' },
          { status: 404 }
        );
      }

      const updateData: Record<string, unknown> = {};
      if (name !== undefined) {
        const trimmed = name.trim();
        if (!trimmed) {
          return NextResponse.json(
            { message: 'Factory name is required' },
            { status: 400 }
          );
        }
        const duplicate = await ctx.prisma.factory.findFirst({
          where: { name: trimmed, id: { not: id } },
        });
        if (duplicate) {
          return NextResponse.json(
            { message: 'Factory name already exists' },
            { status: 400 }
          );
        }
        updateData.name = trimmed;
      }
      if (status !== undefined) updateData.status = status;

      const factory = await ctx.prisma.factory.update({
        where: { id },
        data: updateData,
      });

      return NextResponse.json({ data: factory });
    } catch (error) {
      console.error('Update factory error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withMiddlewares(request, [authMiddleware], async (ctx) => {
    if (ctx.user?.role !== 'ADMIN') {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;

    try {
      const factory = await ctx.prisma.factory.findUnique({
        where: { id },
        include: { _count: { select: { transferTasks: true } } },
      });

      if (!factory) {
        return NextResponse.json(
          { message: 'Factory not found' },
          { status: 404 }
        );
      }

      if (factory._count.transferTasks > 0) {
        return NextResponse.json(
          { message: 'Cannot delete factory with associated transfer tasks' },
          { status: 400 }
        );
      }

      await ctx.prisma.factory.delete({ where: { id } });

      return NextResponse.json({ message: 'Factory deleted successfully' });
    } catch (error) {
      console.error('Delete factory error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}
