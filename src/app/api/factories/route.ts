import { NextRequest, NextResponse } from 'next/server';
import { withMiddlewares, authMiddleware } from '@/lib/middleware';

export async function GET(request: NextRequest) {
  return withMiddlewares(request, [authMiddleware], async (ctx) => {
    try {
      const { searchParams } = new URL(request.url);
      const page = parseInt(searchParams.get('page') || '1');
      const pageSize = parseInt(searchParams.get('pageSize') || '10');
      const search = searchParams.get('search') || '';
      const status = searchParams.get('status') || '';
      const all = searchParams.get('all') === 'true';

      const where: Record<string, unknown> = {};

      if (search) {
        where.name = { contains: search, mode: 'insensitive' };
      }

      if (status) {
        where.status = status;
      }

      if (all) {
        const factories = await ctx.prisma.factory.findMany({
          where: { ...where, status: 'ACTIVE' },
          select: { id: true, name: true, status: true },
          orderBy: { name: 'asc' },
        });
        return NextResponse.json({ data: factories });
      }

      const [total, data] = await Promise.all([
        ctx.prisma.factory.count({ where }),
        ctx.prisma.factory.findMany({
          where,
          include: {
            _count: { select: { transferTasks: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      return NextResponse.json({
        data,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      });
    } catch (error) {
      console.error('Get factories error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

export async function POST(request: NextRequest) {
  return withMiddlewares(request, [authMiddleware], async (ctx) => {
    if (ctx.user?.role !== 'ADMIN') {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    try {
      const body = await request.json();
      const { name } = body;

      if (!name || !name.trim()) {
        return NextResponse.json(
          { message: 'Factory name is required' },
          { status: 400 }
        );
      }

      const existing = await ctx.prisma.factory.findUnique({
        where: { name: name.trim() },
      });

      if (existing) {
        return NextResponse.json(
          { message: 'Factory name already exists' },
          { status: 400 }
        );
      }

      const factory = await ctx.prisma.factory.create({
        data: { name: name.trim() },
      });

      return NextResponse.json({ data: factory }, { status: 201 });
    } catch (error) {
      console.error('Create factory error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}
