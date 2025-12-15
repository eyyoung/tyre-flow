import { NextRequest, NextResponse } from 'next/server';
import { withMiddlewares, adminMiddlewares } from '@/lib/middleware';
import { getLocationService, getApiKeyErrorMessage, getQPSDelay } from '@/lib/location-service';

interface RoutePlanRequest {
  id: string;
  longitude: number;
  latitude: number;
}

// 批量路径规划（管理员专用）
export async function POST(request: NextRequest) {
  return withMiddlewares(request, adminMiddlewares, async (ctx) => {
    try {
      const body = await request.json();
      const { stores, collectionPointId } = body as { 
        stores: RoutePlanRequest[];
        collectionPointId: string;
      };

      if (!stores || !Array.isArray(stores) || stores.length === 0) {
        return NextResponse.json(
          { message: 'No stores provided' },
          { status: 400 }
        );
      }

      if (!collectionPointId) {
        return NextResponse.json(
          { message: 'Collection point ID is required' },
          { status: 400 }
        );
      }

      // 获取收集点信息
      const collectionPoint = await ctx.prisma.collectionPoint.findUnique({
        where: { id: collectionPointId },
      });

      if (!collectionPoint) {
        return NextResponse.json(
          { message: '收集点不存在' },
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

      // 如果收集点没有坐标，先进行地理编码
      let destLng = collectionPoint.longitude;
      let destLat = collectionPoint.latitude;

      if (!destLng || !destLat) {
        // 需要先对收集点进行地理编码
        const fullAddress = [
          collectionPoint.province,
          collectionPoint.city,
          collectionPoint.district,
          collectionPoint.address,
        ].filter(Boolean).join('');
        
        const geocodeResult = await locationService.geocode(fullAddress);

        if (geocodeResult.success && geocodeResult.longitude && geocodeResult.latitude) {
          destLng = geocodeResult.longitude;
          destLat = geocodeResult.latitude;

          // 更新收集点坐标
          await ctx.prisma.collectionPoint.update({
            where: { id: collectionPointId },
            data: { longitude: destLng, latitude: destLat },
          });
        } else {
          return NextResponse.json(
            { message: '无法获取收集点坐标，请先设置收集点的地理坐标' },
            { status: 400 }
          );
        }
      }

      const results: Array<{
        storeId: string;
        success: boolean;
        duration?: number;
        distance?: number;
        error?: string;
      }> = [];

      const qpsDelay = getQPSDelay();

      // 逐个处理（API有QPS限制）
      for (const store of stores) {
        const result = await locationService.planRoute(
          store.longitude,
          store.latitude,
          destLng,
          destLat
        );
        
        results.push({
          storeId: store.id,
          ...result,
        });

        // 如果成功，更新数据库
        if (result.success && result.duration) {
          await ctx.prisma.store.update({
            where: { id: store.id },
            data: {
              estimatedTravelMinutes: result.duration,
            },
          });
        }

        // 添加延迟避免超过QPS限制
        await new Promise(resolve => setTimeout(resolve, qpsDelay));
      }

      return NextResponse.json({ 
        results,
        collectionPointCoords: { longitude: destLng, latitude: destLat },
        provider: locationService.name,
      });
    } catch (error) {
      console.error('Route plan error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}
