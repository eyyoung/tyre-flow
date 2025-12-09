import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAuth, isAdmin } from '@/lib/auth';

interface GeocodeRequest {
  id: string;
  address: string;
}

interface AmapGeocodeResponse {
  status: string;
  info: string;
  infocode: string;
  count: string;
  geocodes: Array<{
    location: string;
    formatted_address: string;
    province: string;
    city: string;
    district: string;
  }>;
}

// 高德地图地理编码API
const AMAP_GEOCODE_URL = 'https://restapi.amap.com/v3/geocode/geo';

// 从环境变量获取高德地图API Key
const getAmapKey = async (): Promise<string | null> => {
  // 优先从环境变量获取
  if (process.env.AMAP_API_KEY) {
    return process.env.AMAP_API_KEY;
  }
  
  // 从数据库配置获取
  const config = await prisma.systemConfig.findUnique({
    where: { key: 'amap_api_key' },
  });
  
  return config?.value || null;
};

// 单个地址地理编码
async function geocodeAddress(
  address: string,
  apiKey: string
): Promise<{ success: boolean; longitude?: number; latitude?: number; error?: string }> {
  try {
    const url = new URL(AMAP_GEOCODE_URL);
    url.searchParams.set('address', address);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('output', 'JSON');

    const response = await fetch(url.toString());
    const data: AmapGeocodeResponse = await response.json();

    if (data.status !== '1') {
      return { success: false, error: `API Error: ${data.info}` };
    }

    if (!data.geocodes || data.geocodes.length === 0) {
      return { success: false, error: '未找到匹配的地址' };
    }

    const location = data.geocodes[0].location;
    if (!location) {
      return { success: false, error: '地址解析结果无坐标' };
    }

    const [lng, lat] = location.split(',').map(Number);
    
    if (isNaN(lng) || isNaN(lat)) {
      return { success: false, error: '坐标格式无效' };
    }

    return { success: true, longitude: lng, latitude: lat };
  } catch (error) {
    return { success: false, error: `请求失败: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
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

      // 获取API Key
      const apiKey = await getAmapKey();
      if (!apiKey) {
        return NextResponse.json(
          { message: '未配置高德地图API Key，请在系统设置或环境变量中配置 AMAP_API_KEY' },
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

      // 逐个处理（高德免费API有QPS限制）
      for (const cp of collectionPoints) {
        const result = await geocodeAddress(cp.address, apiKey);
        
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

        // 添加延迟避免超过QPS限制（高德免费API限制3QPS，保守设置约1.5QPS）
        await new Promise(resolve => setTimeout(resolve, 700));
      }

      return NextResponse.json({ results });
    } catch (error) {
      console.error('Geocode error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}
