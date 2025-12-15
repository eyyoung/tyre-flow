import { NextRequest, NextResponse } from 'next/server';
import { withMiddlewares, adminMiddlewares } from '@/lib/middleware';
import { getLocationService, getApiKeyErrorMessage, getQPSDelay } from '@/lib/location-service';

interface GeocodeRequest {
  id: string;
  address: string;
}

// 批量地理编码（管理员专用）
export async function POST(request: NextRequest) {
  return withMiddlewares(request, adminMiddlewares, async (ctx) => {
    try {
      const body = await request.json();
      const { stores } = body as { stores: GeocodeRequest[] };

      if (!stores || !Array.isArray(stores) || stores.length === 0) {
        return NextResponse.json(
          { message: 'No stores provided' },
          { status: 400 }
        );
      }

      // 获取位置服务
      const locationService = await getLocationService();
      if (!locationService) {
        return NextResponse.json(
          { message: getApiKeyErrorMessage() },
          { status: 400 }
        );
      }

      const results: Array<{
        storeId: string;
        success: boolean;
        longitude?: number;
        latitude?: number;
        error?: string;
      }> = [];

      const qpsDelay = getQPSDelay();

      // 逐个处理（API有QPS限制）
      for (const store of stores) {
        const result = await locationService.geocode(store.address);
        
        results.push({
          storeId: store.id,
          ...result,
        });

        // 如果成功，更新数据库
        if (result.success && result.longitude && result.latitude) {
          await ctx.prisma.store.update({
            where: { id: store.id },
            data: {
              longitude: result.longitude,
              latitude: result.latitude,
            },
          });
        }

        // 添加延迟避免超过QPS限制
        await new Promise(resolve => setTimeout(resolve, qpsDelay));
      }

      return NextResponse.json({ 
        results,
        provider: locationService.name,
      });
    } catch (error) {
      console.error('Geocode error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

// 批量更新门店状态（管理员专用）
export async function PUT(request: NextRequest) {
  return withMiddlewares(request, adminMiddlewares, async (ctx) => {
    try {
      const body = await request.json();
      const { storeIds, status, disabledReason } = body as {
        storeIds: string[];
        status: 'ACTIVE' | 'DISABLED';
        disabledReason?: string;
      };

      if (!storeIds || !Array.isArray(storeIds) || storeIds.length === 0) {
        return NextResponse.json(
          { message: 'No store IDs provided' },
          { status: 400 }
        );
      }

      const updateData: {
        status: 'ACTIVE' | 'DISABLED';
        disabledAt?: Date | null;
        disabledReason?: string | null;
      } = {
        status,
      };

      if (status === 'DISABLED') {
        updateData.disabledAt = new Date();
        updateData.disabledReason = disabledReason || null;
      } else {
        updateData.disabledAt = null;
        updateData.disabledReason = null;
      }

      const result = await ctx.prisma.store.updateMany({
        where: { id: { in: storeIds } },
        data: updateData,
      });

      return NextResponse.json({
        count: result.count,
        message: `Successfully updated ${result.count} stores`,
      });
    } catch (error) {
      console.error('Update stores status error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}
