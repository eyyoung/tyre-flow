import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAuth, isAdmin } from '@/lib/auth';

// 清理测试数据
export async function POST(request: NextRequest) {
  return withAuth(request, async (user) => {
    if (!isAdmin(user)) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    try {
      const body = await request.json();
      const { type, collectionPointId } = body;

      if (!type || !['stores', 'vehicles', 'ledgers'].includes(type)) {
        return NextResponse.json(
          { message: 'Invalid type. Must be one of: stores, vehicles, ledgers' },
          { status: 400 }
        );
      }

      let count = 0;

      switch (type) {
        case 'stores': {
          // 清理门店数据（只清理虚拟门店）
          const where = collectionPointId
            ? { collectionPointId, isVirtual: true }
            : { isVirtual: true };
          
          const result = await prisma.store.deleteMany({ where });
          count = result.count;
          break;
        }

        case 'vehicles': {
          // 清理车辆数据
          const where = collectionPointId ? { collectionPointId } : {};
          const result = await prisma.vehicle.deleteMany({ where });
          count = result.count;
          break;
        }

        case 'ledgers': {
          // 清理台账数据（包括收集记录和转移记录）
          const where = collectionPointId ? { collectionPointId } : {};

          // 先获取台账任务ID
          const tasks = await prisma.ledgerTask.findMany({
            where,
            select: { id: true },
          });
          const taskIds = tasks.map((t) => t.id);

          // 删除收集记录
          await prisma.collectionRecord.deleteMany({
            where: { ledgerTaskId: { in: taskIds } },
          });

          // 删除转移记录
          await prisma.transferRecord.deleteMany({
            where: { ledgerTaskId: { in: taskIds } },
          });

          // 删除台账任务
          const result = await prisma.ledgerTask.deleteMany({ where });
          count = result.count;
          break;
        }
      }

      return NextResponse.json({
        message: `Successfully cleaned up ${count} ${type}`,
        count,
      });
    } catch (error) {
      console.error('Cleanup error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

