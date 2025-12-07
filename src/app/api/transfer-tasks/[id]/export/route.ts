import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import ExcelJS from 'exceljs';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// 导出转移台账数据
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

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
        vehicle: { select: { plateNumber: true, driverName: true, driverPhone: true } },
      },
      orderBy: { loadingTime: 'asc' },
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

    // 创建工作表
    const sheet = workbook.addWorksheet('转移台账');

    // 设置列
    sheet.columns = [
      { header: '记录编号', key: 'recordNo', width: 25 },
      { header: '日期', key: 'date', width: 12 },
      { header: '装车时间', key: 'loadingTime', width: 10 },
      { header: '卸车时间', key: 'unloadingTime', width: 10 },
      { header: '车牌号', key: 'vehiclePlate', width: 12 },
      { header: '司机姓名', key: 'driverName', width: 12 },
      { header: '司机电话', key: 'driverPhone', width: 15 },
      { header: '目的地', key: 'destination', width: 20 },
      { header: '轮胎条数', key: 'tireCount', width: 10 },
      { header: '装车净重（kg）', key: 'loadingNetWeight', width: 15 },
      { header: '毛重（kg）', key: 'grossWeight', width: 12 },
      { header: '皮重（kg）', key: 'tareWeight', width: 12 },
      { header: '卸车净重（kg）', key: 'unloadingNetWeight', width: 15 },
      { header: '折损（kg）', key: 'loss', width: 12 },
      { header: '磅单号', key: 'weighbridgeNo', width: 18 },
    ];

    // 设置表头样式
    sheet.getRow(1).eachCell((cell) => {
      cell.style = headerStyle;
    });
    sheet.getRow(1).height = 25;

    // 添加数据
    transferRecords.forEach((record) => {
      const row = sheet.addRow({
        recordNo: record.recordNo,
        date: record.transferDate.toISOString().slice(0, 10),
        loadingTime: record.loadingTime.toISOString().slice(11, 16),
        unloadingTime: record.unloadingTime.toISOString().slice(11, 16),
        vehiclePlate: record.vehicle.plateNumber,
        driverName: record.vehicle.driverName || '',
        driverPhone: record.vehicle.driverPhone || '',
        destination: record.destination,
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
      recordNo: '合计',
      tireCount: totalTireCount,
      loadingNetWeight: parseFloat(totalLoadingWeight.toFixed(2)),
      unloadingNetWeight: parseFloat(totalUnloadingWeight.toFixed(2)),
      loss: parseFloat(totalLoss.toFixed(2)),
    });
    totalRow.font = { bold: true };

    // 生成 Excel 文件
    const buffer = await workbook.xlsx.writeBuffer();

    // 设置文件名
    const startDateStr = task.startDate.toISOString().slice(0, 10);
    const endDateStr = task.endDate.toISOString().slice(0, 10);
    const fileName = `转移台账_${task.collectionPoint.name}_${startDateStr}_${endDateStr}.xlsx`;
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

