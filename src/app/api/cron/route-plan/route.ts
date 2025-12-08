import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { isRoutePlanTaskRunning } from '@/lib/route-plan-scheduler';

/**
 * 路径规划状态查询 API
 * GET /api/cron/route-plan
 * 
 * 返回当前路径规划任务的状态和待处理门店数量
 */
export async function GET() {
  try {
    // 获取待处理门店数量（排除坐标为 0,0 的门店）
    const pendingCount = await prisma.store.count({
      where: {
        isVirtual: false,
        status: 'ACTIVE',
        longitude: { not: null, notIn: [0] },
        latitude: { not: null, notIn: [0] },
        estimatedTravelMinutes: 0,
      },
    });

    // 获取任务运行状态
    const isRunning = isRoutePlanTaskRunning();

    return NextResponse.json({
      isRunning,
      pendingCount,
      message: isRunning 
        ? `Task is running, ${pendingCount} stores pending`
        : pendingCount > 0 
          ? `${pendingCount} stores pending, task will start soon`
          : 'No stores need route planning',
    });
  } catch (error) {
    console.error('Route plan status error:', error);
    return NextResponse.json(
      { message: 'Internal server error', error: String(error) },
      { status: 500 }
    );
  }
}
