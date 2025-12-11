import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAuth, isAdmin } from '@/lib/auth';
import { getLocationService, getApiKeyErrorMessage, getQPSDelay } from '@/lib/location-service';

interface GeocodeRequest {
  id: string;
  address: string;
}

// 批量地理编码收集点
export async function POST(request: NextRequest) {
  return withAuth(request, async (user) => {
    if (!isAdmin(user)) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    try {
      const body = await request.json();
      const { collectionPoints } = body as { collectionPoints: GeocodeRequest[] };

      if (!collectionPoints || !Array.isArray(collectionPoints) || collectionPoints.length === 0) {
        return NextResponse.json(
          { message: 'No collection points provided' },
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
        collectionPointId: string;
        success: boolean;
        longitude?: number;
        latitude?: number;
        error?: string;
      }> = [];

      const qpsDelay = getQPSDelay();

      // 逐个处理（API有QPS限制）
      for (const cp of collectionPoints) {
        const result = await locationService.geocode(cp.address);
        
        results.push({
          collectionPointId: cp.id,
          ...result,
        });

        // 如果成功，更新数据库
        if (result.success && result.longitude && result.latitude) {
          await prisma.collectionPoint.update({
            where: { id: cp.id },
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
