import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAuth, isAdmin } from '@/lib/auth';

// 默认配置
const defaultConfigs: Record<string, { value: string; description: string; category: string }> = {
  store_count_min: {
    value: '1000',
    description: '每收集点最小门店数',
    category: 'store',
  },
  store_count_max: {
    value: '4000',
    description: '每收集点最大门店数',
    category: 'store',
  },
  collection_vehicle_count: {
    value: '10',
    description: '收集车辆默认数量',
    category: 'vehicle',
  },
  transfer_vehicle_count: {
    value: '5',
    description: '转移车辆默认数量',
    category: 'vehicle',
  },
  collection_vehicle_load: {
    value: '2.0',
    description: '收集车默认载重（吨）',
    category: 'vehicle',
  },
  transfer_vehicle_load: {
    value: '30.0',
    description: '转移车默认载重（吨）',
    category: 'vehicle',
  },
  tire_weight_kg: {
    value: '10',
    description: '单条轮胎重量（kg）',
    category: 'ledger',
  },
  collection_tire_limit: {
    value: '200',
    description: '单次收集条数上限',
    category: 'ledger',
  },
  collection_interval_days: {
    value: '7',
    description: '门店收集间隔天数',
    category: 'ledger',
  },
};

// 获取配置列表
export async function GET(request: NextRequest) {
  return withAuth(request, async (user) => {
    if (!isAdmin(user)) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    try {
      const configs = await prisma.systemConfig.findMany({
        orderBy: { key: 'asc' },
      });

      // 合并默认配置和数据库配置
      const configMap = new Map(configs.map((c) => [c.key, c]));
      const result: Record<string, { value: string; description: string; category: string }> = {};

      for (const [key, defaultConfig] of Object.entries(defaultConfigs)) {
        const dbConfig = configMap.get(key);
        result[key] = {
          value: dbConfig?.value ?? defaultConfig.value,
          description: defaultConfig.description,
          category: defaultConfig.category,
        };
      }

      return NextResponse.json({ data: result });
    } catch (error) {
      console.error('Get settings error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

// 更新配置
export async function PUT(request: NextRequest) {
  return withAuth(request, async (user) => {
    if (!isAdmin(user)) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    try {
      const body = await request.json();
      const configs = body.configs as Record<string, string>;

      // 验证配置键是否合法
      for (const key of Object.keys(configs)) {
        if (!defaultConfigs[key]) {
          return NextResponse.json(
            { message: `Invalid config key: ${key}` },
            { status: 400 }
          );
        }
      }

      // 批量更新或创建配置
      for (const [key, value] of Object.entries(configs)) {
        await prisma.systemConfig.upsert({
          where: { key },
          update: { value },
          create: {
            key,
            value,
            description: defaultConfigs[key].description,
            category: defaultConfigs[key].category,
          },
        });
      }

      return NextResponse.json({ message: 'Settings updated successfully' });
    } catch (error) {
      console.error('Update settings error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

