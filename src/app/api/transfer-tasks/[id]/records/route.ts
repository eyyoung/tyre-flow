import { NextRequest, NextResponse } from 'next/server';
import { withMiddlewares, standardMiddlewares } from '@/lib/middleware';

// 获取转移记录
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    try {
      const { id } = await params;
      const { searchParams } = new URL(request.url);
      const page = parseInt(searchParams.get('page') || '1');
      const pageSize = parseInt(searchParams.get('pageSize') || '20');

      // ctx.prisma 已自动带收集点权限过滤
      const [total, data] = await Promise.all([
        ctx.prisma.transferRecord.count({ where: { taskId: id } }),
        ctx.prisma.transferRecord.findMany({
          where: { taskId: id },
          include: {
            vehicle: {
              select: { plateNumber: true },
            },
          },
          orderBy: { transferDate: 'asc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      return NextResponse.json({
        data,
        total,
        page,
        pageSize,
      });
    } catch (error) {
      console.error('Error fetching transfer records:', error);
      return NextResponse.json(
        { error: '获取转移记录失败' },
        { status: 500 }
      );
    }
  });
}
