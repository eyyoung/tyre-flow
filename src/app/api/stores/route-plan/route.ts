import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAuth, isAdmin } from '@/lib/auth';

interface RoutePlanRequest {
  id: string;
  longitude: number;
  latitude: number;
}

interface AmapDirectionResponse {
  status: string;
  info: string;
  infocode: string;
  count: string;
  route: {
    origin: string;
    destination: string;
    paths: Array<{
      distance: string;
      duration: string;
      strategy: string;
    }>;
  };
}

// 高德地图驾车路径规划API
const AMAP_DIRECTION_URL = 'https://restapi.amap.com/v3/direction/driving';

// 从环境变量获取高德地图API Key
const getAmapKey = async (): Promise<string | null> => {
  if (process.env.AMAP_API_KEY) {
    return process.env.AMAP_API_KEY;
  }
  
  const config = await prisma.systemConfig.findUnique({
    where: { key: 'amap_api_key' },
  });
  
  return config?.value || null;
};

// 单个路径规划
async function planRoute(
  originLng: number,
  originLat: number,
  destLng: number,
  destLat: number,
  apiKey: string
): Promise<{ success: boolean; duration?: number; distance?: number; error?: string }> {
  try {
    const url = new URL(AMAP_DIRECTION_URL);
    url.searchParams.set('origin', `${originLng},${originLat}`);
    url.searchParams.set('destination', `${destLng},${destLat}`);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('output', 'JSON');
    url.searchParams.set('strategy', '0'); // 速度优先

    const response = await fetch(url.toString());
    const data: AmapDirectionResponse = await response.json();

    if (data.status !== '1') {
      return { success: false, error: `API Error: ${data.info}` };
    }

    if (!data.route || !data.route.paths || data.route.paths.length === 0) {
      return { success: false, error: '未找到可行路线' };
    }

    const path = data.route.paths[0];
    const durationSeconds = parseInt(path.duration);
    const distanceMeters = parseInt(path.distance);

    if (isNaN(durationSeconds)) {
      return { success: false, error: '时间格式无效' };
    }

    // 转换为分钟，向上取整
    const durationMinutes = Math.ceil(durationSeconds / 60);

    return { 
      success: true, 
      duration: durationMinutes,
      distance: distanceMeters,
    };
  } catch (error) {
    return { success: false, error: `请求失败: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}

// 批量路径规划
export async function POST(request: NextRequest) {
  return withAuth(request, async (user) => {
    if (!isAdmin(user)) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

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
      const collectionPoint = await prisma.collectionPoint.findUnique({
        where: { id: collectionPointId },
      });

      if (!collectionPoint) {
        return NextResponse.json(
          { message: '收集点不存在' },
          { status: 400 }
        );
      }

      // 如果收集点没有坐标，先进行地理编码
      let destLng = collectionPoint.longitude;
      let destLat = collectionPoint.latitude;

      if (!destLng || !destLat) {
        // 需要先对收集点进行地理编码
        const apiKey = await getAmapKey();
        if (!apiKey) {
          return NextResponse.json(
            { message: '未配置高德地图API Key' },
            { status: 400 }
          );
        }

        const geocodeUrl = new URL('https://restapi.amap.com/v3/geocode/geo');
        const fullAddress = [
          collectionPoint.province,
          collectionPoint.city,
          collectionPoint.district,
          collectionPoint.address,
        ].filter(Boolean).join('');
        
        geocodeUrl.searchParams.set('address', fullAddress);
        geocodeUrl.searchParams.set('key', apiKey);
        geocodeUrl.searchParams.set('output', 'JSON');

        const geocodeResponse = await fetch(geocodeUrl.toString());
        const geocodeData = await geocodeResponse.json();

        if (geocodeData.status === '1' && geocodeData.geocodes && geocodeData.geocodes.length > 0) {
          const location = geocodeData.geocodes[0].location;
          const [lng, lat] = location.split(',').map(Number);
          destLng = lng;
          destLat = lat;

          // 更新收集点坐标
          await prisma.collectionPoint.update({
            where: { id: collectionPointId },
            data: { longitude: lng, latitude: lat },
          });
        } else {
          return NextResponse.json(
            { message: '无法获取收集点坐标，请先设置收集点的地理坐标' },
            { status: 400 }
          );
        }
      }

      // 获取API Key
      const apiKey = await getAmapKey();
      if (!apiKey) {
        return NextResponse.json(
          { message: '未配置高德地图API Key，请在系统设置或环境变量中配置 AMAP_API_KEY' },
          { status: 400 }
        );
      }

      const results: Array<{
        storeId: string;
        success: boolean;
        duration?: number;
        distance?: number;
        error?: string;
      }> = [];

      // 逐个处理（高德免费API有QPS限制）
      for (const store of stores) {
        const result = await planRoute(
          store.longitude,
          store.latitude,
          destLng,
          destLat,
          apiKey
        );
        
        results.push({
          storeId: store.id,
          ...result,
        });

        // 如果成功，更新数据库
        if (result.success && result.duration) {
          await prisma.store.update({
            where: { id: store.id },
            data: {
              estimatedTravelMinutes: result.duration,
            },
          });
        }

        // 添加延迟避免超过QPS限制（高德免费API限制3QPS，保守设置约1.5QPS）
        await new Promise(resolve => setTimeout(resolve, 700));
      }

      return NextResponse.json({ 
        results,
        collectionPointCoords: { longitude: destLng, latitude: destLat },
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

