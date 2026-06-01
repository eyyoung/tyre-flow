import { NextRequest, NextResponse } from 'next/server';
import { withMiddlewares, standardMiddlewares } from '@/lib/middleware';
import { executeTransferTask } from '@/lib/transfer-generator';

// 触发生成转移记录
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    if (ctx.user?.role !== 'ADMIN') {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    try {
      const { id } = await params;
      const task = await ctx.prisma.transferTask.findUnique({
        where: { id },
        select: { id: true },
      });

      if (!task) {
        return NextResponse.json(
          { error: '转移任务不存在' },
          { status: 404 }
        );
      }
      
      const summary = await executeTransferTask(id);

      return NextResponse.json({ message: '转移记录生成成功', summary });
    } catch (error) {
      console.error('Error generating transfer records:', error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : '生成转移记录失败' },
        { status: 500 }
      );
    }
  });
}
