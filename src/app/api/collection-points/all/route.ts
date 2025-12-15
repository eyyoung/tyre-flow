import { NextRequest, NextResponse } from 'next/server';
import { withMiddlewares, adminMiddlewares } from '@/lib/middleware';
import prisma from '@/lib/db';

// 获取所有收集点（管理员专用，用于用户分配收集点）
export async function GET(request: NextRequest) {
  return withMiddlewares(request, adminMiddlewares, async () => {
    try {
      // 管理员获取所有收集点，不受权限过滤
      const collectionPoints = await prisma.collectionPoint.findMany({
        select: {
          id: true,
          code: true,
          name: true,
          status: true,
        },
        orderBy: { code: 'asc' },
      });

      return NextResponse.json({ data: collectionPoints });
    } catch (error) {
      console.error('Get all collection points error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}
