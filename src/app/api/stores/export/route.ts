import { NextRequest, NextResponse } from 'next/server';
import { withMiddlewares, standardMiddlewares } from '@/lib/middleware';
import { getTranslatedValue, TranslationCache } from '@/lib/translations';
import ExcelJS from 'exceljs';

// 导出门店 Excel
export async function GET(request: NextRequest) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    try {
      const { searchParams } = new URL(request.url);
      const collectionPointId = searchParams.get('collectionPointId') || '';
      const status = searchParams.get('status') || '';
      const isVirtual = searchParams.get('isVirtual') || '';
      const hasEstimatedTime = searchParams.get('hasEstimatedTime') || '';
      const includeEstimatedTime = searchParams.get('includeEstimatedTime') !== 'false'; // 默认导出
      const lang = searchParams.get('lang') || 'zh'; // 导出语言

      // 多语言标签
      const labels = {
        zh: {
          sheetName: '门店列表',
          code: '门店编码',
          name: '企业名称',
          collectionPoint: '收集点',
          businessLicense: '统一社会信用代码',
          legalPerson: '法定代表人',
          province: '所属省份',
          city: '所属城市',
          district: '所属区县',
          address: '注册地址',
          longitude: '经度',
          latitude: '纬度',
          contactName: '联系人',
          contactPhone: '电话',
          estimatedTime: '预估行程(分钟)',
          isVirtual: '是否虚拟',
          status: '状态',
          statusActive: '正常',
          statusDisabled: '停用',
          yes: '是',
          no: '否',
          fileName: '门店列表',
        },
        en: {
          sheetName: 'Store List',
          code: 'Store Code',
          name: 'Company Name',
          collectionPoint: 'Collection Point',
          businessLicense: 'Business License',
          legalPerson: 'Legal Representative',
          province: 'Province',
          city: 'City',
          district: 'District',
          address: 'Address',
          longitude: 'Longitude',
          latitude: 'Latitude',
          contactName: 'Contact',
          contactPhone: 'Phone',
          estimatedTime: 'Est. Travel (min)',
          isVirtual: 'Virtual',
          status: 'Status',
          statusActive: 'Active',
          statusDisabled: 'Disabled',
          yes: 'Yes',
          no: 'No',
          fileName: 'Store_List',
        },
      };
      const l = labels[lang as keyof typeof labels] || labels.zh;

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

      if (hasEstimatedTime === 'true') {
        where.estimatedTravelMinutes = { gt: 0 };
      } else if (hasEstimatedTime === 'false') {
        where.estimatedTravelMinutes = 0;
      }

      // 获取门店数据 - ctx.prisma 已自动带收集点权限过滤
      const stores = await ctx.prisma.store.findMany({
        where,
        include: {
          collectionPoint: {
            select: { name: true, code: true },
          },
        },
        orderBy: [
          { collectionPoint: { name: 'asc' } },
          { code: 'asc' },
        ],
        // 包含翻译字段（Prisma 会自动选择所有标量字段）
      });

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

      // 设置列（当筛选非虚拟门店时，不显示"是否虚拟"列）
      const showIsVirtualColumn = isVirtual !== 'false';
      
      // 表头使用多语言标签
      const columns: Partial<ExcelJS.Column>[] = [
        { header: l.code, key: 'code', width: 20 },
        { header: l.name, key: 'name', width: 30 },
        { header: l.collectionPoint, key: 'collectionPointName', width: 15 },
        { header: l.businessLicense, key: 'businessLicense', width: 22 },
        { header: l.legalPerson, key: 'legalPerson', width: 12 },
        { header: l.province, key: 'province', width: 10 },
        { header: l.city, key: 'city', width: 10 },
        { header: l.district, key: 'district', width: 10 },
        { header: l.address, key: 'address', width: 40 },
        { header: l.longitude, key: 'longitude', width: 12 },
        { header: l.latitude, key: 'latitude', width: 12 },
        { header: l.contactName, key: 'contactName', width: 12 },
        { header: l.contactPhone, key: 'contactPhone', width: 15 },
      ];
      
      // 根据参数决定是否添加预估行程列
      if (includeEstimatedTime) {
        columns.push({ header: l.estimatedTime, key: 'estimatedTravelMinutes', width: 16 });
      }
      
      if (showIsVirtualColumn) {
        columns.push({ header: l.isVirtual, key: 'isVirtual', width: 10 });
      }
      
      columns.push(
        { header: l.status, key: 'status', width: 10 },
      );
      
      worksheet.columns = columns;

      // 应用表头样式
      worksheet.getRow(1).eachCell((cell) => {
        cell.style = headerStyle;
      });
      worksheet.getRow(1).height = 25;

      // 添加数据
      stores.forEach((store: (typeof stores)[number]) => {
        const rowData: Record<string, unknown> = {
          code: store.code,
          // 使用翻译值（如果有）
          name: getTranslatedValue(
            store.name,
            store.nameTranslations as TranslationCache | null,
            lang
          ),
          collectionPointName: store.collectionPoint.name,
          businessLicense: store.businessLicense || '',
          legalPerson: getTranslatedValue(
            store.legalPerson,
            store.legalPersonTranslations as TranslationCache | null,
            lang
          ),
          province: store.province || '',
          city: store.city || '',
          district: store.district || '',
          address: getTranslatedValue(
            store.address,
            store.addressTranslations as TranslationCache | null,
            lang
          ),
          longitude: store.longitude || '',
          latitude: store.latitude || '',
          contactName: store.contactName || '',
          contactPhone: store.contactPhone || '',
          status: store.status === 'ACTIVE' ? l.statusActive : l.statusDisabled,
        };
        
        // 根据参数决定是否添加预估行程数据
        if (includeEstimatedTime) {
          rowData.estimatedTravelMinutes = store.estimatedTravelMinutes;
        }
        
        if (showIsVirtualColumn) {
          rowData.isVirtual = store.isVirtual ? l.yes : l.no;
        }
        
        const row = worksheet.addRow(rowData);

        // 应用单元格样式
        row.eachCell((cell) => {
          cell.style = cellStyle;
        });
      });

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
