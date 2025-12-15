import { NextRequest, NextResponse } from 'next/server';
import { withMiddlewares, standardMiddlewares } from '@/lib/middleware';
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
      });

      // 创建 Excel 工作簿
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('门店列表');

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
      
      // 表头使用与导入兼容的名称，便于导出后重新导入
      const columns: Partial<ExcelJS.Column>[] = [
        { header: '门店编码', key: 'code', width: 20 },
        { header: '企业名称', key: 'name', width: 30 },              // 兼容导入
        { header: '收集点', key: 'collectionPointName', width: 15 },
        { header: '统一社会信用代码', key: 'businessLicense', width: 22 },  // 兼容导入
        { header: '法定代表人', key: 'legalPerson', width: 12 },     // 兼容导入
        { header: '所属省份', key: 'province', width: 10 },          // 兼容导入
        { header: '所属城市', key: 'city', width: 10 },              // 兼容导入
        { header: '所属区县', key: 'district', width: 10 },          // 兼容导入
        { header: '注册地址', key: 'address', width: 40 },           // 兼容导入
        { header: '经度', key: 'longitude', width: 12 },             // 兼容导入
        { header: '纬度', key: 'latitude', width: 12 },              // 兼容导入
        { header: '联系人', key: 'contactName', width: 12 },
        { header: '电话', key: 'contactPhone', width: 15 },          // 兼容导入
      ];
      
      // 根据参数决定是否添加预估行程列
      if (includeEstimatedTime) {
        columns.push({ header: '预估行程(分钟)', key: 'estimatedTravelMinutes', width: 16 });
      }
      
      if (showIsVirtualColumn) {
        columns.push({ header: '是否虚拟', key: 'isVirtual', width: 10 });
      }
      
      columns.push(
        { header: '状态', key: 'status', width: 10 },
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
          name: store.name,
          collectionPointName: store.collectionPoint.name,
          businessLicense: store.businessLicense || '',
          legalPerson: store.legalPerson || '',
          province: store.province || '',
          city: store.city || '',
          district: store.district || '',
          address: store.address,
          longitude: store.longitude || '',
          latitude: store.latitude || '',
          contactName: store.contactName || '',
          contactPhone: store.contactPhone || '',
          status: store.status === 'ACTIVE' ? '正常' : '停用',
        };
        
        // 根据参数决定是否添加预估行程数据
        if (includeEstimatedTime) {
          rowData.estimatedTravelMinutes = store.estimatedTravelMinutes;
        }
        
        if (showIsVirtualColumn) {
          rowData.isVirtual = store.isVirtual ? '是' : '否';
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
      const fileName = `门店列表_${timestamp}.xlsx`;

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
