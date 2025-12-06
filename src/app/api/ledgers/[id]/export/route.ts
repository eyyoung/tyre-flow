import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAuth, isAdmin } from '@/lib/auth';
import ExcelJS from 'exceljs';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// 导出台账数据
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withAuth(request, async (user) => {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'collection'; // collection only (transfer moved to TransferTask)
    const lang = searchParams.get('lang') || 'zh'; // zh | en

    try {
      // 获取任务信息
      const task = await prisma.ledgerTask.findUnique({
        where: { id },
        include: {
          collectionPoint: true,
        },
      });

      if (!task) {
        return NextResponse.json({ message: 'Task not found' }, { status: 404 });
      }

      // 非管理员检查权限
      if (!isAdmin(user)) {
        const binding = await prisma.userCollectionPoint.findUnique({
          where: {
            userId_collectionPointId: {
              userId: user.userId,
              collectionPointId: task.collectionPointId,
            },
          },
        });

        if (!binding) {
          return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
        }
      }

      // 创建工作簿
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Tyre Flow System';
      workbook.created = new Date();

      // 多语言标签
      const labels = {
        zh: {
          collectionSheet: '收集台账',
          transferSheet: '转移台账',
          recordNo: '记录编号',
          date: '日期',
          storeName: '门店名称',
          storeCode: '门店编码',
          storeAddress: '门店地址',
          vehiclePlate: '车牌号',
          tireCount: '轮胎条数',
          weight: '重量（吨）',
          destination: '目的地',
          grossWeight: '毛重（吨）',
          tareWeight: '皮重（吨）',
          netWeight: '净重（吨）',
          weighbridgeNo: '磅单号',
          remarks: '备注',
          summary: '汇总信息',
          collectionPoint: '收集点',
          yearMonth: '年月',
          targetTonnage: '目标吨数',
          actualTonnage: '实际吨数',
          totalRecords: '总记录数',
        },
        en: {
          collectionSheet: 'Collection Ledger',
          transferSheet: 'Transfer Ledger',
          recordNo: 'Record No.',
          date: 'Date',
          storeName: 'Store Name',
          storeCode: 'Store Code',
          storeAddress: 'Store Address',
          vehiclePlate: 'Vehicle Plate',
          tireCount: 'Tire Count',
          weight: 'Weight (ton)',
          destination: 'Destination',
          grossWeight: 'Gross Weight (ton)',
          tareWeight: 'Tare Weight (ton)',
          netWeight: 'Net Weight (ton)',
          weighbridgeNo: 'Weighbridge No.',
          remarks: 'Remarks',
          summary: 'Summary',
          collectionPoint: 'Collection Point',
          yearMonth: 'Year-Month',
          targetTonnage: 'Target Tonnage',
          actualTonnage: 'Actual Tonnage',
          totalRecords: 'Total Records',
        },
      };

      const l = labels[lang as keyof typeof labels] || labels.zh;

      // 设置单元格样式
      const headerStyle: Partial<ExcelJS.Style> = {
        font: { bold: true, color: { argb: 'FFFFFFFF' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1677FF' } },
        alignment: { horizontal: 'center', vertical: 'middle' },
        border: {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        },
      };

      const cellStyle: Partial<ExcelJS.Style> = {
        alignment: { horizontal: 'left', vertical: 'middle' },
        border: {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        },
      };

      // 收集台账
      if (type === 'all' || type === 'collection') {
        const collectionRecords = await prisma.collectionRecord.findMany({
          where: { taskId: id },
          include: {
            store: { select: { code: true, name: true, address: true } },
            vehicle: { select: { plateNumber: true } },
          },
          orderBy: { collectionDate: 'asc' },
        });

        const collectionSheet = workbook.addWorksheet(l.collectionSheet);

        // 设置列宽
        collectionSheet.columns = [
          { header: l.recordNo, key: 'recordNo', width: 25 },
          { header: l.date, key: 'date', width: 15 },
          { header: l.storeCode, key: 'storeCode', width: 20 },
          { header: l.storeName, key: 'storeName', width: 30 },
          { header: l.storeAddress, key: 'storeAddress', width: 40 },
          { header: l.vehiclePlate, key: 'vehiclePlate', width: 15 },
          { header: l.tireCount, key: 'tireCount', width: 12 },
          { header: l.weight, key: 'weight', width: 15 },
          { header: l.remarks, key: 'remarks', width: 20 },
        ];

        // 设置表头样式
        collectionSheet.getRow(1).eachCell((cell) => {
          cell.style = headerStyle;
        });
        collectionSheet.getRow(1).height = 25;

        // 添加数据
        collectionRecords.forEach((record) => {
          const row = collectionSheet.addRow({
            recordNo: record.recordNo,
            date: record.collectionDate.toISOString().slice(0, 10),
            storeCode: record.store.code,
            storeName: record.store.name,
            storeAddress: record.store.address,
            vehiclePlate: record.vehicle.plateNumber,
            tireCount: record.tireCount,
            weight: record.weight,
            remarks: record.remarks || '',
          });
          row.eachCell((cell) => {
            cell.style = cellStyle;
          });
        });
      }

      // 转移台账已移至独立的 TransferTask，此处不再导出

      // 生成 Excel 文件
      const buffer = await workbook.xlsx.writeBuffer();

      // 设置文件名
      const fileName = `台账_${task.collectionPoint.name}_${task.year}年${task.month}月.xlsx`;
      const encodedFileName = encodeURIComponent(fileName);

      return new NextResponse(buffer, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodedFileName}`,
        },
      });
    } catch (error) {
      console.error('Export ledger error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

