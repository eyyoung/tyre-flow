import { NextRequest, NextResponse } from 'next/server';
import { withMiddlewares, standardMiddlewares } from '@/lib/middleware';

// 批量更新车辆皮重和最大载重
export async function PUT(request: NextRequest) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    // 只有管理员可以批量更新车辆
    if (ctx.user?.role !== 'ADMIN') {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    try {
      const body = await request.json();
      const {
        collectionPointId,
        type, // 可选，筛选车辆类型
        tareWeight, // 皮重（kg），可选
        maxLoad, // 最大载重（kg），可选
      } = body;

      // 验证必填字段
      if (!collectionPointId) {
        return NextResponse.json(
          { message: 'Collection point ID is required' },
          { status: 400 }
        );
      }

      // 车辆类型必填
      if (!type || (type !== 'COLLECTION' && type !== 'TRANSFER')) {
        return NextResponse.json(
          { message: 'Vehicle type is required' },
          { status: 400 }
        );
      }

      // 至少需要修改一个字段
      if (tareWeight === undefined && maxLoad === undefined) {
        return NextResponse.json(
          { message: 'At least one of tareWeight or maxLoad must be provided' },
          { status: 400 }
        );
      }

      // 构建查询条件
      const where: Record<string, unknown> = {
        collectionPointId,
        status: 'ACTIVE', // 只更新启用状态的车辆
        type, // 车辆类型必填
      };

      // 构建更新数据
      const updateData: Record<string, number> = {};
      if (tareWeight !== undefined && tareWeight !== null) {
        updateData.tareWeight = parseFloat(tareWeight);
      }
      if (maxLoad !== undefined && maxLoad !== null) {
        updateData.maxLoad = parseFloat(maxLoad);
      }

      // 执行批量更新
      const result = await ctx.prisma.vehicle.updateMany({
        where,
        data: updateData,
      });

      return NextResponse.json({
        message: 'Batch update successful',
        count: result.count,
      });
    } catch (error) {
      console.error('Batch update vehicles error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}
