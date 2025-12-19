import { NextRequest, NextResponse } from 'next/server';
import { withMiddlewares, adminMiddlewares, standardMiddlewares } from '@/lib/middleware';
import alimt20181012, * as $alimt20181012 from '@alicloud/alimt20181012';
import * as $OpenApi from '@alicloud/openapi-client';
import * as $Util from '@alicloud/tea-util';
import Credential, { Config } from '@alicloud/credentials';

// 创建阿里云翻译客户端
function createClient(): alimt20181012 {
  const credentialsConfig = new Config({
    type: 'access_key',
    accessKeyId: process.env.ALIBABA_CLOUD_ACCESS_KEY_ID,
    accessKeySecret: process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET,
  });
  const credential = new Credential(credentialsConfig);
  const config = new $OpenApi.Config({
    credential: credential,
  });
  config.endpoint = 'mt.cn-hangzhou.aliyuncs.com';
  return new alimt20181012(config);
}

// 翻译单个文本
async function translateText(
  client: alimt20181012,
  text: string,
  sourceLanguage: string = 'zh',
  targetLanguage: string = 'en'
): Promise<string | null> {
  if (!text || text.trim() === '') {
    return null;
  }

  try {
    const request = new $alimt20181012.TranslateGeneralRequest({
      formatType: 'text',
      sourceLanguage,
      targetLanguage,
      sourceText: text,
      scene: 'general',
    });

    const runtime = new $Util.RuntimeOptions({});
    const response = await client.translateGeneralWithOptions(request, runtime);

    if (response.body?.code === 200 && response.body.data?.translated) {
      return response.body.data.translated;
    }
    return null;
  } catch (error) {
    console.error('Translation error:', error);
    return null;
  }
}

interface TranslateResult {
  vehicleId: string;
  success: boolean;
  driverNameTranslation?: string;
  error?: string;
}

// GET: 获取待翻译的车辆/司机列表
export async function GET(request: NextRequest) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    try {
      const { searchParams } = new URL(request.url);
      const collectionPointId = searchParams.get('collectionPointId') || '';
      const status = searchParams.get('status') || ''; // 'translated', 'pending', ''
      const page = parseInt(searchParams.get('page') || '1');
      const pageSize = parseInt(searchParams.get('pageSize') || '50');

      if (!collectionPointId) {
        return NextResponse.json(
          { message: 'Collection point ID is required' },
          { status: 400 }
        );
      }

      // 构建查询条件
      interface WhereClause {
        collectionPointId: string;
        status: 'ACTIVE';
        driverName: { not: null };
        OR?: Array<{
          driverNameTranslations?: { equals: null } | { not: null };
        }>;
        AND?: Array<{
          OR: Array<{
            driverNameTranslations?: { not: null };
          }>;
        }>;
      }

      const where: WhereClause = {
        collectionPointId,
        status: 'ACTIVE',
        driverName: { not: null }, // 只查询有司机姓名的车辆
      };

      // 根据翻译状态过滤
      if (status === 'pending') {
        where.OR = [
          { driverNameTranslations: { equals: null } },
        ];
      } else if (status === 'translated') {
        where.AND = [
          {
            OR: [
              { driverNameTranslations: { not: null } },
            ],
          },
        ];
      }

      const [total, vehicles] = await Promise.all([
        ctx.prisma.vehicle.count({ where }),
        ctx.prisma.vehicle.findMany({
          where,
          select: {
            id: true,
            plateNumber: true,
            type: true,
            driverName: true,
            driverNameTranslations: true,
            driverPhone: true,
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      // 计算统计数据 - 直接查询总数
      const totalVehicles = await ctx.prisma.vehicle.count({
        where: {
          collectionPointId,
          status: 'ACTIVE',
          driverName: { not: null },
        },
      });

      // 已翻译数量
      const translatedCount = await ctx.prisma.vehicle.count({
        where: {
          collectionPointId,
          status: 'ACTIVE',
          driverName: { not: null },
          driverNameTranslations: { not: null },
        },
      });

      return NextResponse.json({
        data: vehicles,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
        stats: {
          total: totalVehicles,
          translated: translatedCount,
          pending: totalVehicles - translatedCount,
        },
      });
    } catch (error) {
      console.error('Get vehicles for translation error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

// POST: 批量翻译司机姓名
export async function POST(request: NextRequest) {
  return withMiddlewares(request, adminMiddlewares, async (ctx) => {
    try {
      const body = await request.json();
      const { vehicleIds, targetLanguage = 'en' } = body;

      if (!vehicleIds || !Array.isArray(vehicleIds) || vehicleIds.length === 0) {
        return NextResponse.json(
          { message: 'Vehicle IDs are required' },
          { status: 400 }
        );
      }

      // 检查阿里云凭证配置
      if (!process.env.ALIBABA_CLOUD_ACCESS_KEY_ID || !process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET) {
        return NextResponse.json(
          { message: 'Alibaba Cloud credentials not configured' },
          { status: 500 }
        );
      }

      // 获取车辆数据
      const vehicles = await ctx.prisma.vehicle.findMany({
        where: {
          id: { in: vehicleIds },
        },
        select: {
          id: true,
          driverName: true,
          driverNameTranslations: true,
        },
      });

      const client = createClient();
      const results: TranslateResult[] = [];

      // 逐个翻译（避免超过 API QPS 限制）
      for (const vehicle of vehicles) {
        if (!vehicle.driverName) {
          results.push({
            vehicleId: vehicle.id,
            success: false,
            error: 'No driver name',
          });
          continue;
        }

        try {
          // 翻译司机姓名
          const driverNameTranslation = await translateText(client, vehicle.driverName, 'zh', targetLanguage);

          // 更新数据库
          const existingTranslations = (vehicle.driverNameTranslations as Record<string, string> | null) || {};

          await ctx.prisma.vehicle.update({
            where: { id: vehicle.id },
            data: {
              driverNameTranslations: driverNameTranslation
                ? { ...existingTranslations, [targetLanguage]: driverNameTranslation }
                : existingTranslations,
            },
          });

          results.push({
            vehicleId: vehicle.id,
            success: true,
            driverNameTranslation: driverNameTranslation || undefined,
          });

          // 添加延迟避免超过 QPS 限制
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          console.error(`Translation error for vehicle ${vehicle.id}:`, error);
          results.push({
            vehicleId: vehicle.id,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      const successCount = results.filter(r => r.success).length;
      const failedCount = results.filter(r => !r.success).length;

      return NextResponse.json({
        results,
        summary: {
          total: vehicles.length,
          success: successCount,
          failed: failedCount,
        },
      });
    } catch (error) {
      console.error('Batch translate error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

// DELETE: 清除翻译数据
export async function DELETE(request: NextRequest) {
  return withMiddlewares(request, adminMiddlewares, async (ctx) => {
    try {
      const body = await request.json();
      const { vehicleIds, targetLanguage } = body;

      if (!vehicleIds || !Array.isArray(vehicleIds) || vehicleIds.length === 0) {
        return NextResponse.json(
          { message: 'Vehicle IDs are required' },
          { status: 400 }
        );
      }

      // 如果指定了目标语言，只清除该语言的翻译；否则清除所有翻译
      if (targetLanguage) {
        // 获取车辆数据
        const vehicles = await ctx.prisma.vehicle.findMany({
          where: { id: { in: vehicleIds } },
          select: {
            id: true,
            driverNameTranslations: true,
          },
        });

        for (const vehicle of vehicles) {
          const driverNameTranslations = (vehicle.driverNameTranslations as Record<string, string> | null) || {};

          delete driverNameTranslations[targetLanguage];

          await ctx.prisma.vehicle.update({
            where: { id: vehicle.id },
            data: {
              driverNameTranslations: Object.keys(driverNameTranslations).length > 0 ? driverNameTranslations : null,
            },
          });
        }
      } else {
        // 清除所有翻译
        await ctx.prisma.vehicle.updateMany({
          where: { id: { in: vehicleIds } },
          data: {
            driverNameTranslations: null,
          },
        });
      }

      return NextResponse.json({
        count: vehicleIds.length,
      });
    } catch (error) {
      console.error('Clear translations error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

