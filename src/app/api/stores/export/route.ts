import { NextRequest, NextResponse } from 'next/server';
import { withMiddlewares, standardMiddlewares } from '@/lib/middleware';
import { getTranslatedValue, TranslationCache } from '@/lib/translations';
import { calculateSignDate } from '@/lib/iscc-utils';
import { pinyin } from 'pinyin-pro';
import dayjs from 'dayjs';
import ExcelJS from 'exceljs';
import path from 'path';

// 将中文转换为拼音（首字母大写）
function toPinyin(text: string | null | undefined): string {
  if (!text) return '';
  
  // 检查是否包含中文字符
  const hasChinese = /[\u4e00-\u9fa5]/.test(text);
  if (!hasChinese) {
    return text;
  }
  
  // 转换为拼音，每个词首字母大写
  const result = pinyin(text, {
    toneType: 'none', // 不带声调
    type: 'array',    // 返回数组
  });
  
  // 首字母大写
  return result
    .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

// 导出门店 Excel（ISCC 格式）
export async function GET(request: NextRequest) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    try {
      const { searchParams } = new URL(request.url);
      const collectionPointId = searchParams.get('collectionPointId') || '';
      const status = searchParams.get('status') || '';
      const isVirtual = searchParams.get('isVirtual') || '';
      const lang = searchParams.get('lang') || 'en'; // 默认英文

      // 多语言标签
      const labels = {
        zh: {
          country: '中国',
          legalType: '法人实体',
          fileName: '门店列表',
          sheetName: '门店列表',
        },
        en: {
          country: 'China',
          legalType: 'Legal Entity',
          fileName: 'Store_List',
          sheetName: 'Store List',
        },
      };
      const l = labels[lang as keyof typeof labels] || labels.en;

      // 构建查询条件
      const where: Record<string, unknown> = {};

      if (collectionPointId) {
        where.collectionPointId = collectionPointId;
      }

      if (status) {
        where.status = status;
      }

      if (isVirtual !== '') {
        where.isVirtual = isVirtual === 'true';
      }

      // 获取门店数据 - ctx.prisma 已自动带收集点权限过滤
      const stores = await ctx.prisma.store.findMany({
        where,
        include: {
          collectionPoint: {
            select: {
              name: true,
              code: true,
              city: true,
              province: true,
              postcode: true,
            },
          },
        },
        orderBy: [
          { collectionPoint: { name: 'asc' } },
          { code: 'asc' },
        ],
      });

      // 筛选出没有缓存签署日期的门店，批量查询首次收集日期
      const storesWithoutCachedDate = stores.filter(
        (s: { isccSignDate: Date | null }) => !s.isccSignDate
      );
      const storeIdsWithoutCachedDate = storesWithoutCachedDate.map(
        (s: { id: string }) => s.id
      );

      // 批量查询需要的门店的第一次收集记录时间
      const firstCollectionDateMap = new Map<string, Date>();
      if (storeIdsWithoutCachedDate.length > 0) {
        const firstCollectionRecords = await ctx.prisma.collectionRecord.groupBy({
          by: ['storeId'],
          where: { storeId: { in: storeIdsWithoutCachedDate } },
          _min: { loadingTime: true },
        });
        for (const record of firstCollectionRecords) {
          if (record._min.loadingTime) {
            firstCollectionDateMap.set(record.storeId, record._min.loadingTime);
          }
        }
      }

      // 收集需要更新签署日期的门店
      const storesToUpdateSignDate: { id: string; signDate: Date }[] = [];

      // 加载模板文件
      const workbook = new ExcelJS.Workbook();
      const templatePath = path.join(process.cwd(), 'template', 'store_list_template.xlsx');
      await workbook.xlsx.readFile(templatePath);

      // 获取 Sheet1 工作表
      const worksheet = workbook.getWorksheet('Sheet1');
      if (!worksheet) {
        throw new Error('Template worksheet "Sheet1" not found');
      }

      // 数据从第2行开始（第1行是表头）
      let currentRow = 2;

      // 添加数据
      for (const store of stores) {
        // 计算签署日期
        const firstCollectionDate = firstCollectionDateMap.get(store.id) ?? null;
        const { signDate, isNewlyCalculated } = calculateSignDate(
          store.isccSignDate,
          firstCollectionDate,
          store.createdAt
        );

        // 记录需要更新的门店
        if (isNewlyCalculated) {
          storesToUpdateSignDate.push({ id: store.id, signDate });
        }

        // 格式化日期为 YYYY-MM-DD
        const dateOfAdding = dayjs(signDate).format('YYYY-MM-DD');

        // 获取翻译后的值
        const siteName = getTranslatedValue(
          store.name,
          store.nameTranslations as TranslationCache | null,
          lang
        );
        const address = getTranslatedValue(
          store.address,
          store.addressTranslations as TranslationCache | null,
          lang
        );

        // 城市和省份转拼音
        const city = toPinyin(store.collectionPoint.city);
        const state = toPinyin(store.collectionPoint.province);

        // 格式化经纬度
        const latitude = store.latitude ? store.latitude.toFixed(6) : '';
        const longitude = store.longitude ? store.longitude.toFixed(6) : '';

        // 按模板列顺序填入数据
        const row = worksheet.getRow(currentRow);
        row.getCell(1).value = store.code;                          // A: ID
        row.getCell(2).value = 'No';                                // B: Individual certification
        row.getCell(3).value = '';                                  // C: Certificate ID
        row.getCell(4).value = siteName;                            // D: Site Name
        row.getCell(5).value = address;                             // E: Address
        row.getCell(6).value = store.collectionPoint.postcode || '';// F: Post code
        row.getCell(7).value = city;                                // G: City
        row.getCell(8).value = state;                               // H: State
        row.getCell(9).value = l.country;                           // I: Country
        row.getCell(10).value = latitude;                           // J: Latitude
        row.getCell(11).value = longitude;                          // K: Longitude
        row.getCell(12).value = l.legalType;                        // L: Legal Type
        row.getCell(13).value = '';                                 // M: Other legal identification
        row.getCell(14).value = '';                                 // N: Email
        row.getCell(15).value = '';                                 // O: National Trade Register Type
        row.getCell(16).value = '';                                 // P: National Trade Register ID
        row.getCell(17).value = '';                                 // Q: VAT
        row.getCell(18).value = '';                                 // R: Website
        row.getCell(19).value = store.contactPhone || '';           // S: Phone
        row.getCell(20).value = 'Point of Origin';                  // T: Scope of Sourcing
        row.getCell(21).value = 'End-of-life tires';                // U: Outgoing Material
        row.getCell(22).value = dateOfAdding;                       // V: Date of adding
        row.getCell(23).value = '';                                 // W: Date of removal
        row.getCell(24).value = 119;                                // X: Maximum capacity
        row.getCell(25).value = 119;                                // Y: Renewable capacity
        row.getCell(26).value = 'tonnes';                           // Z: Measuring Unit

        row.commit();
        currentRow++;
      }

      // 批量更新新计算的签署日期到数据库
      if (storesToUpdateSignDate.length > 0) {
        await Promise.all(
          storesToUpdateSignDate.map((item) =>
            ctx.prisma.store.update({
              where: { id: item.id },
              data: { isccSignDate: item.signDate },
            })
          )
        );
      }

      // 生成文件
      const buffer = await workbook.xlsx.writeBuffer();

      // 生成文件名：<门店列表>_<收集点名称>_<日期>.xlsx，前两段跟随导出语言
      let collectionPointLabel = '';
      if (collectionPointId) {
        const collectionPoint = await ctx.prisma.collectionPoint.findUnique({
          where: { id: collectionPointId },
          select: { name: true, nameTranslations: true },
        });
        if (collectionPoint) {
          collectionPointLabel = getTranslatedValue(
            collectionPoint.name,
            collectionPoint.nameTranslations as TranslationCache | null,
            lang
          );
        }
      }
      const timestamp = new Date().toISOString().slice(0, 10);
      const fileName = `${[l.fileName, collectionPointLabel, timestamp]
        .filter(Boolean)
        .join('_')
        .replace(/[/\\?%*:|"<>]/g, '_')
        .replace(/\s+/g, '_')}.xlsx`;

      return new NextResponse(buffer, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        },
      });
    } catch (error) {
      console.error('Export stores error:', error);
      return NextResponse.json(
        { message: 'Export failed' },
        { status: 500 }
      );
    }
  });
}
