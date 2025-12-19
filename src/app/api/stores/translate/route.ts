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
  storeId: string;
  success: boolean;
  nameTranslation?: string;
  addressTranslation?: string;
  legalPersonTranslation?: string;
  error?: string;
}

// GET: 获取待翻译的门店列表
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
        isVirtual: boolean;
        status: 'ACTIVE';
        OR?: Array<{
          nameTranslations?: { equals: null } | { not: null };
          addressTranslations?: { equals: null } | { not: null };
          legalPersonTranslations?: { equals: null } | { not: null };
        }>;
        AND?: Array<{
          OR: Array<{
            nameTranslations?: { not: null };
            addressTranslations?: { not: null };
            legalPersonTranslations?: { not: null };
          }>;
        }>;
      }

      const where: WhereClause = {
        collectionPointId,
        isVirtual: false, // 只翻译非虚拟门店
        status: 'ACTIVE',
      };

      // 根据翻译状态过滤
      if (status === 'pending') {
        // 待翻译：至少有一个字段没有翻译
        where.OR = [
          { nameTranslations: { equals: null } },
          { addressTranslations: { equals: null } },
          { legalPersonTranslations: { equals: null } },
        ];
      } else if (status === 'translated') {
        // 已翻译：所有字段都有翻译
        where.AND = [
          {
            OR: [
              { nameTranslations: { not: null } },
            ],
          },
        ];
      }

      const [total, stores] = await Promise.all([
        ctx.prisma.store.count({ where }),
        ctx.prisma.store.findMany({
          where,
          select: {
            id: true,
            code: true,
            name: true,
            nameTranslations: true,
            address: true,
            addressTranslations: true,
            legalPerson: true,
            legalPersonTranslations: true,
            province: true,
            city: true,
            district: true,
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      // 计算统计数据 - 直接查询总数
      const totalStores = await ctx.prisma.store.count({
        where: {
          collectionPointId,
          isVirtual: false,
          status: 'ACTIVE',
        },
      });

      // 已翻译数量：nameTranslations 不为 null
      const translatedCount = await ctx.prisma.store.count({
        where: {
          collectionPointId,
          isVirtual: false,
          status: 'ACTIVE',
          nameTranslations: { not: null },
        },
      });

      return NextResponse.json({
        data: stores,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
        stats: {
          total: totalStores,
          translated: translatedCount,
          pending: totalStores - translatedCount,
        },
      });
    } catch (error) {
      console.error('Get stores for translation error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

// POST: 批量翻译门店
export async function POST(request: NextRequest) {
  return withMiddlewares(request, adminMiddlewares, async (ctx) => {
    try {
      const body = await request.json();
      const { storeIds, targetLanguage = 'en' } = body;

      if (!storeIds || !Array.isArray(storeIds) || storeIds.length === 0) {
        return NextResponse.json(
          { message: 'Store IDs are required' },
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

      // 获取门店数据
      const stores = await ctx.prisma.store.findMany({
        where: {
          id: { in: storeIds },
        },
        select: {
          id: true,
          name: true,
          nameTranslations: true,
          address: true,
          addressTranslations: true,
          legalPerson: true,
          legalPersonTranslations: true,
          province: true,
          city: true,
          district: true,
        },
      });

      const client = createClient();
      const results: TranslateResult[] = [];

      // 逐个翻译（避免超过 API QPS 限制）
      for (const store of stores) {
        try {
          // 构造完整地址
          const fullAddress = [
            store.province,
            store.city,
            store.district,
            store.address,
          ].filter(Boolean).join('');

          // 翻译各字段
          const [nameTranslation, addressTranslation, legalPersonTranslation] = await Promise.all([
            translateText(client, store.name, 'zh', targetLanguage),
            translateText(client, fullAddress, 'zh', targetLanguage),
            store.legalPerson ? translateText(client, store.legalPerson, 'zh', targetLanguage) : Promise.resolve(null),
          ]);

          // 更新数据库
          const existingNameTranslations = (store.nameTranslations as Record<string, string> | null) || {};
          const existingAddressTranslations = (store.addressTranslations as Record<string, string> | null) || {};
          const existingLegalPersonTranslations = (store.legalPersonTranslations as Record<string, string> | null) || {};

          await ctx.prisma.store.update({
            where: { id: store.id },
            data: {
              nameTranslations: nameTranslation
                ? { ...existingNameTranslations, [targetLanguage]: nameTranslation }
                : existingNameTranslations,
              addressTranslations: addressTranslation
                ? { ...existingAddressTranslations, [targetLanguage]: addressTranslation }
                : existingAddressTranslations,
              legalPersonTranslations: legalPersonTranslation
                ? { ...existingLegalPersonTranslations, [targetLanguage]: legalPersonTranslation }
                : existingLegalPersonTranslations,
            },
          });

          results.push({
            storeId: store.id,
            success: true,
            nameTranslation: nameTranslation || undefined,
            addressTranslation: addressTranslation || undefined,
            legalPersonTranslation: legalPersonTranslation || undefined,
          });

          // 添加延迟避免超过 QPS 限制（阿里云免费版限制约 50 QPS）
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          console.error(`Translation error for store ${store.id}:`, error);
          results.push({
            storeId: store.id,
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
          total: stores.length,
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
      const { storeIds, targetLanguage } = body;

      if (!storeIds || !Array.isArray(storeIds) || storeIds.length === 0) {
        return NextResponse.json(
          { message: 'Store IDs are required' },
          { status: 400 }
        );
      }

      // 如果指定了目标语言，只清除该语言的翻译；否则清除所有翻译
      if (targetLanguage) {
        // 获取门店数据
        const stores = await ctx.prisma.store.findMany({
          where: { id: { in: storeIds } },
          select: {
            id: true,
            nameTranslations: true,
            addressTranslations: true,
            legalPersonTranslations: true,
          },
        });

        for (const store of stores) {
          const nameTranslations = (store.nameTranslations as Record<string, string> | null) || {};
          const addressTranslations = (store.addressTranslations as Record<string, string> | null) || {};
          const legalPersonTranslations = (store.legalPersonTranslations as Record<string, string> | null) || {};

          delete nameTranslations[targetLanguage];
          delete addressTranslations[targetLanguage];
          delete legalPersonTranslations[targetLanguage];

          await ctx.prisma.store.update({
            where: { id: store.id },
            data: {
              nameTranslations: Object.keys(nameTranslations).length > 0 ? nameTranslations : null,
              addressTranslations: Object.keys(addressTranslations).length > 0 ? addressTranslations : null,
              legalPersonTranslations: Object.keys(legalPersonTranslations).length > 0 ? legalPersonTranslations : null,
            },
          });
        }
      } else {
        // 清除所有翻译
        await ctx.prisma.store.updateMany({
          where: { id: { in: storeIds } },
          data: {
            nameTranslations: null,
            addressTranslations: null,
            legalPersonTranslations: null,
          },
        });
      }

      return NextResponse.json({
        count: storeIds.length,
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
