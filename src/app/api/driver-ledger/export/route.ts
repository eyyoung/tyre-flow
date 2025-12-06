import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import ExcelJS from 'exceljs';

// 导出司机台账 Excel
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const driverId = searchParams.get('driverId') || '';
    const collectionPointId = searchParams.get('collectionPointId') || '';
    const recordType = searchParams.get('recordType') || 'all';
    const startDate = searchParams.get('startDate') || '';
    const endDate = searchParams.get('endDate') || '';

    // 构建日期条件
    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (startDate) {
      dateFilter.gte = new Date(startDate);
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }

    // 获取司机信息
    let driverInfo: { name: string; phone: string } | null = null;
    if (driverId) {
      const vehicle = await prisma.vehicle.findUnique({
        where: { id: driverId },
        select: { driverName: true, driverPhone: true },
      });
      if (vehicle) {
        driverInfo = { name: vehicle.driverName || '', phone: vehicle.driverPhone || '' };
      }
    }

    // 获取收集记录
    let collectionRecords: Array<{
      recordNo: string;
      date: Date;
      departureTime: Date;
      arrivalTime: Date;
      driverName: string;
      driverPhone: string;
      vehiclePlate: string;
      storeName: string;
      tireCount: number;
      weight: number;
    }> = [];

    if (recordType === 'all' || recordType === 'collection') {
      const collectionWhere: Record<string, unknown> = {};
      
      if (driverId) {
        collectionWhere.vehicleId = driverId;
      }
      
      if (collectionPointId) {
        collectionWhere.vehicle = { collectionPointId };
      }
      
      if (Object.keys(dateFilter).length > 0) {
        collectionWhere.collectionDate = dateFilter;
      }

      const records = await prisma.collectionRecord.findMany({
        where: collectionWhere,
        include: {
          vehicle: { select: { plateNumber: true, driverName: true, driverPhone: true } },
          store: { select: { name: true } },
        },
        orderBy: { collectionDate: 'asc' },
      });

      collectionRecords = records.map(r => ({
        recordNo: r.recordNo,
        date: r.collectionDate,
        departureTime: r.departureTime,
        arrivalTime: r.arrivalTime,
        driverName: r.vehicle.driverName || '',
        driverPhone: r.vehicle.driverPhone || '',
        vehiclePlate: r.vehicle.plateNumber,
        storeName: r.store.name,
        tireCount: r.tireCount,
        weight: r.weight,
      }));
    }

    // 获取转移记录
    let transferRecords: Array<{
      recordNo: string;
      date: Date;
      departureTime: Date;
      arrivalTime: Date;
      driverName: string;
      driverPhone: string;
      vehiclePlate: string;
      destination: string;
      tireCount: number;
      grossWeight: number;
      tareWeight: number;
      netWeight: number;
      weighbridgeNo: string;
    }> = [];

    if (recordType === 'all' || recordType === 'transfer') {
      const transferWhere: Record<string, unknown> = {};
      
      if (driverId) {
        transferWhere.vehicleId = driverId;
      }
      
      if (collectionPointId) {
        transferWhere.vehicle = { collectionPointId };
      }
      
      if (Object.keys(dateFilter).length > 0) {
        transferWhere.transferDate = dateFilter;
      }

      const records = await prisma.transferRecord.findMany({
        where: transferWhere,
        include: {
          vehicle: { select: { plateNumber: true, driverName: true, driverPhone: true } },
        },
        orderBy: { transferDate: 'asc' },
      });

      transferRecords = records.map(r => ({
        recordNo: r.recordNo,
        date: r.transferDate,
        departureTime: r.departureTime,
        arrivalTime: r.arrivalTime,
        driverName: r.vehicle.driverName || '',
        driverPhone: r.vehicle.driverPhone || '',
        vehiclePlate: r.vehicle.plateNumber,
        destination: r.destination,
        tireCount: r.tireCount,
        grossWeight: r.grossWeight,
        tareWeight: r.tareWeight,
        netWeight: r.netWeight,
        weighbridgeNo: r.weighbridgeNo || '',
      }));
    }

    // 创建工作簿
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Tyre Flow System';
    workbook.created = new Date();

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

    // 收集记录工作表
    if (collectionRecords.length > 0) {
      const collectionSheet = workbook.addWorksheet('收集记录');
      collectionSheet.columns = [
        { header: '记录编号', key: 'recordNo', width: 25 },
        { header: '日期', key: 'date', width: 12 },
        { header: '出发时间', key: 'departureTime', width: 10 },
        { header: '到达时间', key: 'arrivalTime', width: 10 },
        { header: '司机姓名', key: 'driverName', width: 12 },
        { header: '司机电话', key: 'driverPhone', width: 15 },
        { header: '车牌号', key: 'vehiclePlate', width: 12 },
        { header: '门店', key: 'storeName', width: 25 },
        { header: '轮胎条数', key: 'tireCount', width: 10 },
        { header: '重量（吨）', key: 'weight', width: 12 },
      ];

      collectionSheet.getRow(1).eachCell((cell) => {
        cell.style = headerStyle;
      });
      collectionSheet.getRow(1).height = 25;

      collectionRecords.forEach((record) => {
        const row = collectionSheet.addRow({
          recordNo: record.recordNo,
          date: record.date.toISOString().slice(0, 10),
          departureTime: record.departureTime.toISOString().slice(11, 16),
          arrivalTime: record.arrivalTime.toISOString().slice(11, 16),
          driverName: record.driverName,
          driverPhone: record.driverPhone,
          vehiclePlate: record.vehiclePlate,
          storeName: record.storeName,
          tireCount: record.tireCount,
          weight: record.weight,
        });
        row.eachCell((cell) => {
          cell.style = cellStyle;
        });
      });

      // 添加汇总行
      const totalWeight = collectionRecords.reduce((sum, r) => sum + r.weight, 0);
      const totalRow = collectionSheet.addRow({
        recordNo: '合计',
        tireCount: collectionRecords.reduce((sum, r) => sum + r.tireCount, 0),
        weight: parseFloat(totalWeight.toFixed(3)),
      });
      totalRow.font = { bold: true };
    }

    // 转移记录工作表
    if (transferRecords.length > 0) {
      const transferSheet = workbook.addWorksheet('转移记录');
      transferSheet.columns = [
        { header: '记录编号', key: 'recordNo', width: 25 },
        { header: '日期', key: 'date', width: 12 },
        { header: '出发时间', key: 'departureTime', width: 10 },
        { header: '到达时间', key: 'arrivalTime', width: 10 },
        { header: '司机姓名', key: 'driverName', width: 12 },
        { header: '司机电话', key: 'driverPhone', width: 15 },
        { header: '车牌号', key: 'vehiclePlate', width: 12 },
        { header: '目的地', key: 'destination', width: 20 },
        { header: '轮胎条数', key: 'tireCount', width: 10 },
        { header: '毛重', key: 'grossWeight', width: 12 },
        { header: '皮重', key: 'tareWeight', width: 12 },
        { header: '净重', key: 'netWeight', width: 12 },
        { header: '磅单号', key: 'weighbridgeNo', width: 18 },
      ];

      transferSheet.getRow(1).eachCell((cell) => {
        cell.style = headerStyle;
      });
      transferSheet.getRow(1).height = 25;

      transferRecords.forEach((record) => {
        const row = transferSheet.addRow({
          recordNo: record.recordNo,
          date: record.date.toISOString().slice(0, 10),
          departureTime: record.departureTime.toISOString().slice(11, 16),
          arrivalTime: record.arrivalTime.toISOString().slice(11, 16),
          driverName: record.driverName,
          driverPhone: record.driverPhone,
          vehiclePlate: record.vehiclePlate,
          destination: record.destination,
          tireCount: record.tireCount,
          grossWeight: record.grossWeight,
          tareWeight: record.tareWeight,
          netWeight: record.netWeight,
          weighbridgeNo: record.weighbridgeNo,
        });
        row.eachCell((cell) => {
          cell.style = cellStyle;
        });
      });

      // 添加汇总行
      const totalNetWeight = transferRecords.reduce((sum, r) => sum + r.netWeight, 0);
      const totalRow = transferSheet.addRow({
        recordNo: '合计',
        tireCount: transferRecords.reduce((sum, r) => sum + r.tireCount, 0),
        netWeight: parseFloat(totalNetWeight.toFixed(3)),
      });
      totalRow.font = { bold: true };
    }

    // 生成文件
    const buffer = await workbook.xlsx.writeBuffer();

    // 文件名
    const dateRange = startDate && endDate ? `${startDate}_${endDate}` : new Date().toISOString().slice(0, 10);
    const driverName = driverInfo?.name || '全部司机';
    const fileName = `司机台账_${driverName}_${dateRange}.xlsx`;
    const encodedFileName = encodeURIComponent(fileName);

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodedFileName}`,
      },
    });
  } catch (error) {
    console.error('Export driver ledger error:', error);
    return NextResponse.json(
      { error: '导出司机台账失败' },
      { status: 500 }
    );
  }
}

