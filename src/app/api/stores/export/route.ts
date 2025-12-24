import { NextRequest, NextResponse } from 'next/server';
import { withMiddlewares, standardMiddlewares } from '@/lib/middleware';
import { getTranslatedValue, TranslationCache } from '@/lib/translations';
import { calculateSignDate } from '@/lib/iscc-utils';
import { pinyin } from 'pinyin-pro';
import dayjs from 'dayjs';
import ExcelJS from 'exceljs';

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

      // 创建 Excel 工作簿
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet(l.sheetName);

      // 定义表头样式
      const headerStyle: Partial<ExcelJS.Style> = {
        font: { bold: true, size: 11, color: { argb: 'FFFFFFFF' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } },
        alignment: { horizontal: 'center', vertical: 'middle' },
        border: {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        },
      };

      // 定义单元格样式
      const cellStyle: Partial<ExcelJS.Style> = {
        font: { size: 10 },
        alignment: { vertical: 'middle' },
        border: {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        },
      };

      // 设置列（按照模板要求的字段）
      worksheet.columns = [
        { header: 'ID', key: 'id', width: 30 },
        { header: 'Individual certification', key: 'individualCertification', width: 20 },
        { header: 'Certificate ID', key: 'certificateId', width: 15 },
        { header: 'Site Name', key: 'siteName', width: 40 },
        { header: 'Address', key: 'address', width: 50 },
        { header: 'Post code', key: 'postCode', width: 12 },
        { header: 'City', key: 'city', width: 15 },
        { header: 'State', key: 'state', width: 15 },
        { header: 'Country', key: 'country', width: 10 },
        { header: 'Latitude (format: xx.xxxxxx)', key: 'latitude', width: 25 },
        { header: 'Longitude (format: xxx.xxxxxx)', key: 'longitude', width: 25 },
        { header: 'Legal Type', key: 'legalType', width: 15 },
        { header: 'Other legal identification', key: 'otherLegalId', width: 20 },
        { header: 'Email', key: 'email', width: 15 },
        { header: 'National Trade Register Identification Type', key: 'nationalTradeType', width: 35 },
        { header: 'National Trade Register Identification', key: 'nationalTradeId', width: 30 },
        { header: 'VAT', key: 'vat', width: 15 },
        { header: 'Website', key: 'website', width: 15 },
        { header: 'Phone', key: 'phone', width: 15 },
        { header: 'Scope of Sourcing Contact', key: 'scopeOfSourcing', width: 25 },
        { header: 'Outgoing Material', key: 'outgoingMaterial', width: 20 },
        { header: 'Date of adding', key: 'dateOfAdding', width: 15 },
        { header: 'Date of removal', key: 'dateOfRemoval', width: 15 },
        { header: 'Maximum capacity per year', key: 'maxCapacity', width: 22 },
        { header: 'Renewable capacity per year', key: 'renewableCapacity', width: 25 },
        { header: 'Measuring Unit', key: 'measuringUnit', width: 15 },
      ];

      // 应用表头样式
      worksheet.getRow(1).eachCell((cell) => {
        cell.style = headerStyle;
      });
      worksheet.getRow(1).height = 25;

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

        const rowData = {
          id: store.code,
          individualCertification: 'No',
          certificateId: '',
          siteName: siteName,
          address: address,
          postCode: store.collectionPoint.postcode || '',
          city: city,
          state: state,
          country: l.country,
          latitude: latitude,
          longitude: longitude,
          legalType: l.legalType,
          otherLegalId: '',
          email: '',
          nationalTradeType: '',
          nationalTradeId: '',
          vat: '',
          website: '',
          phone: store.contactPhone || '',
          scopeOfSourcing: 'Point of Origin',
          outgoingMaterial: 'End-of-life tires',
          dateOfAdding: dateOfAdding,
          dateOfRemoval: '',
          maxCapacity: 119,
          renewableCapacity: 119,
          measuringUnit: 'tonnes',
        };

        const row = worksheet.addRow(rowData);

        // 应用单元格样式
        row.eachCell((cell) => {
          cell.style = cellStyle;
        });
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

      // 冻结首行
      worksheet.views = [{ state: 'frozen', ySplit: 1 }];

      // 生成文件
      const buffer = await workbook.xlsx.writeBuffer();

      // 生成文件名
      const timestamp = new Date().toISOString().slice(0, 10);
      const fileName = `${l.fileName}_${timestamp}.xlsx`;

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
