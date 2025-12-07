import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAuth, isAdmin } from '@/lib/auth';
import { executeLedgerTask } from '@/lib/ledger-generator';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// 执行台账生成（重新生成）
export async function POST(request: NextRequest, { params }: RouteParams) {
  return withAuth(request, async (user) => {
    if (!isAdmin(user)) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;

    try {
      const task = await prisma.ledgerTask.findUnique({
        where: { id },
      });

      if (!task) {
        return NextResponse.json({ message: 'Task not found' }, { status: 404 });
      }

      if (task.status === 'PROCESSING') {
        return NextResponse.json(
          { message: '任务正在处理中，请稍后' },
          { status: 400 }
        );
      }

      // 如果任务已完成或失败，需要先重置状态
      if (task.status === 'COMPLETED' || task.status === 'FAILED') {
        await prisma.ledgerTask.update({
          where: { id },
          data: {
            status: 'PENDING',
            actualTonnage: null,
            unloadingTonnage: null,
            totalLoss: null,
            errorMessage: null,
            startedAt: null,
            completedAt: null,
          },
        });
      }

      // 同步执行生成任务
      const result = await executeLedgerTask(id);

      return NextResponse.json({
        message: '台账生成完成',
        taskId: id,
        summary: result,
      });
    } catch (error) {
      console.error('Generate ledger error:', error);
      return NextResponse.json(
        { message: error instanceof Error ? error.message : 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

