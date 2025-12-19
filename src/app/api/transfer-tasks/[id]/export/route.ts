import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { formatDateCN } from '@/lib/timezone';
import { getTranslatedValue } from '@/lib/translations';
import ExcelJS from 'exceljs';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// 导出转移台账数据
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const lang = searchParams.get('lang') || 'zh';

    // 获取任务信息
    const task = await prisma.transferTask.findUnique({
      where: { id },
      include: {
        collectionPoint: true,
      },
    });

    if (!task) {
      return NextResponse.json({ message: 'Task not found' }, { status: 404 });
    }

    // 获取转移记录
    const transferRecords = await prisma.transferRecord.findMany({
      where: { taskId: id },
      include: {
        vehicle: { 
          select: { 
            plateNumber: true, 
            driverName: true, 
            driverNameTranslations: true,
            driverPhone: true,
          } 
        },
      },
      orderBy: { transferDate: 'asc' },
    });

    // 创建工作簿
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Tyre Flow System';
    workbook.created = new Date();

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

    // 多语言标签
    const labels = lang === 'zh' ? {
      sheetName: '转移台账',
      recordNo: '记录编号',
      date: '日期',
      vehiclePlate: '车牌号',
      driverName: '司机姓名',
      driverPhone: '司机电话',
      tireCount: '轮胎条数',
      loadingNetWeight: '装车净重（kg）',
      grossWeight: '毛重（kg）',
      tareWeight: '皮重（kg）',
      unloadingNetWeight: '卸车净重（kg）',
      loss: '折损（kg）',
      weighbridgeNo: '磅单号',
      total: '合计',
    } : {
      sheetName: 'Transfer Records',
      recordNo: 'Record No.',
      date: 'Date',
      vehiclePlate: 'Vehicle Plate',
      driverName: 'Driver Name',
      driverPhone: 'Driver Phone',
      tireCount: 'Tire Count',
      loadingNetWeight: 'Loading Net (kg)',
      grossWeight: 'Gross (kg)',
      tareWeight: 'Tare (kg)',
      unloadingNetWeight: 'Unloading Net (kg)',
      loss: 'Loss (kg)',
      weighbridgeNo: 'Weighbridge No.',
      total: 'Total',
    };

    // 创建工作表
    const sheet = workbook.addWorksheet(labels.sheetName);

    // 设置列
    sheet.columns = [
      { header: labels.recordNo, key: 'recordNo', width: 25 },
      { header: labels.date, key: 'date', width: 12 },
      { header: labels.vehiclePlate, key: 'vehiclePlate', width: 12 },
      { header: labels.driverName, key: 'driverName', width: 12 },
      { header: labels.driverPhone, key: 'driverPhone', width: 15 },
      { header: labels.tireCount, key: 'tireCount', width: 10 },
      { header: labels.loadingNetWeight, key: 'loadingNetWeight', width: 15 },
      { header: labels.grossWeight, key: 'grossWeight', width: 12 },
      { header: labels.tareWeight, key: 'tareWeight', width: 12 },
      { header: labels.unloadingNetWeight, key: 'unloadingNetWeight', width: 15 },
      { header: labels.loss, key: 'loss', width: 12 },
      { header: labels.weighbridgeNo, key: 'weighbridgeNo', width: 18 },
    ];

    // 设置表头样式
    sheet.getRow(1).eachCell((cell) => {
      cell.style = headerStyle;
    });
    sheet.getRow(1).height = 25;

    // 添加数据
    transferRecords.forEach((record) => {
      // 获取翻译后的司机姓名
      const driverName = getTranslatedValue(
        record.vehicle.driverName,
        record.vehicle.driverNameTranslations as Record<string, string> | null,
        lang
      );

      const row = sheet.addRow({
        recordNo: record.recordNo,
        date: formatDateCN(record.transferDate),
        vehiclePlate: record.vehicle.plateNumber,
        driverName: driverName || '',
        driverPhone: record.vehicle.driverPhone || '',
        tireCount: record.tireCount,
        loadingNetWeight: record.loadingNetWeight,
        grossWeight: record.grossWeight,
        tareWeight: record.tareWeight,
        unloadingNetWeight: record.unloadingNetWeight,
        loss: record.loss,
        weighbridgeNo: record.weighbridgeNo || '',
      });
      row.eachCell((cell) => {
        cell.style = cellStyle;
      });
    });

    // 添加汇总行
    const totalTireCount = transferRecords.reduce((sum, r) => sum + r.tireCount, 0);
    const totalLoadingWeight = transferRecords.reduce((sum, r) => sum + r.loadingNetWeight, 0);
    const totalUnloadingWeight = transferRecords.reduce((sum, r) => sum + r.unloadingNetWeight, 0);
    const totalLoss = transferRecords.reduce((sum, r) => sum + r.loss, 0);
    
    const totalRow = sheet.addRow({
      recordNo: labels.total,
      tireCount: totalTireCount,
      loadingNetWeight: parseFloat(totalLoadingWeight.toFixed(2)),
      unloadingNetWeight: parseFloat(totalUnloadingWeight.toFixed(2)),
      loss: parseFloat(totalLoss.toFixed(2)),
    });
    totalRow.font = { bold: true };

    // 生成 Excel 文件
    const buffer = await workbook.xlsx.writeBuffer();

    // 设置文件名: 收集点_日期范围_转移记录.xlsx
    const startDateStr = formatDateCN(task.startDate);
    const endDateStr = formatDateCN(task.endDate);
    const fileName = `${task.collectionPoint.name}_${startDateStr}-${endDateStr}_转移记录.xlsx`;
    const encodedFileName = encodeURIComponent(fileName);

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodedFileName}`,
      },
    });
  } catch (error) {
    console.error('Export transfer task error:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}

