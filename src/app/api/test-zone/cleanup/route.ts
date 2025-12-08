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
      const { type, collectionPointId, includeNonVirtual } = body;

      if (!type || !['stores', 'vehicles', 'ledgers'].includes(type)) {
        return NextResponse.json(
          { message: 'Invalid type. Must be one of: stores, vehicles, ledgers' },
          { status: 400 }
        );
      }

      let count = 0;

      switch (type) {
        case 'stores': {
          // 清理门店数据
          // 如果 includeNonVirtual 为 true，则清理所有门店；否则只清理虚拟门店
          const where = includeNonVirtual
            ? (collectionPointId ? { collectionPointId } : {})
            : (collectionPointId ? { collectionPointId, isVirtual: true } : { isVirtual: true });
          
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
          // 清理台账数据
          const where = collectionPointId ? { collectionPointId } : {};

          // 删除收集台账任务（会级联删除收集记录）
          const ledgerResult = await prisma.ledgerTask.deleteMany({ where });

          // 删除转移台账任务（会级联删除转移记录）
          const transferResult = await prisma.transferTask.deleteMany({ where });

          count = ledgerResult.count + transferResult.count;
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

