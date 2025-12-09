import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { formatDateCN, formatTimeCN } from '@/lib/timezone';
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
      loadingTime: Date;
      unloadingTime: Date;
      driverName: string;
      driverPhone: string;
      vehiclePlate: string;
      storeName: string;
      tireCount: number;
      loadingNetWeight: number;
      unloadingNetWeight: number;
      loss: number;
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
        loadingTime: r.loadingTime,
        unloadingTime: r.unloadingTime,
        driverName: r.vehicle.driverName || '',
        driverPhone: r.vehicle.driverPhone || '',
        vehiclePlate: r.vehicle.plateNumber,
        storeName: r.store.name,
        tireCount: r.tireCount,
        loadingNetWeight: r.loadingNetWeight,
        unloadingNetWeight: r.unloadingNetWeight,
        loss: r.loss,
      }));
    }

    // 获取转移记录
    let transferRecords: Array<{
      recordNo: string;
      date: Date;
      loadingTime: Date;
      unloadingTime: Date;
      driverName: string;
      driverPhone: string;
      vehiclePlate: string;
      destination: string;
      tireCount: number;
      loadingNetWeight: number;
      grossWeight: number;
      tareWeight: number;
      unloadingNetWeight: number;
      loss: number;
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
        loadingTime: r.loadingTime,
        unloadingTime: r.unloadingTime,
        driverName: r.vehicle.driverName || '',
        driverPhone: r.vehicle.driverPhone || '',
        vehiclePlate: r.vehicle.plateNumber,
        destination: r.destination,
        tireCount: r.tireCount,
        loadingNetWeight: r.loadingNetWeight,
        grossWeight: r.grossWeight,
        tareWeight: r.tareWeight,
        unloadingNetWeight: r.unloadingNetWeight,
        loss: r.loss,
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
        { header: '装车时间', key: 'loadingTime', width: 10 },
        { header: '卸车时间', key: 'unloadingTime', width: 10 },
        { header: '司机姓名', key: 'driverName', width: 12 },
        { header: '司机电话', key: 'driverPhone', width: 15 },
        { header: '车牌号', key: 'vehiclePlate', width: 12 },
        { header: '门店', key: 'storeName', width: 25 },
        { header: '轮胎条数', key: 'tireCount', width: 10 },
        { header: '装车净重（kg）', key: 'loadingNetWeight', width: 15 },
        { header: '卸车净重（kg）', key: 'unloadingNetWeight', width: 15 },
        { header: '折损（kg）', key: 'loss', width: 12 },
      ];

      collectionSheet.getRow(1).eachCell((cell) => {
        cell.style = headerStyle;
      });
      collectionSheet.getRow(1).height = 25;

      collectionRecords.forEach((record) => {
        const row = collectionSheet.addRow({
          recordNo: record.recordNo,
          date: formatDateCN(record.date),
          loadingTime: formatTimeCN(record.loadingTime),
          unloadingTime: formatTimeCN(record.unloadingTime),
          driverName: record.driverName,
          driverPhone: record.driverPhone,
          vehiclePlate: record.vehiclePlate,
          storeName: record.storeName,
          tireCount: record.tireCount,
          loadingNetWeight: record.loadingNetWeight,
          unloadingNetWeight: record.unloadingNetWeight,
          loss: record.loss,
        });
        row.eachCell((cell) => {
          cell.style = cellStyle;
        });
      });

      // 添加汇总行
      const totalUnloadingWeight = collectionRecords.reduce((sum, r) => sum + r.unloadingNetWeight, 0);
      const totalLoss = collectionRecords.reduce((sum, r) => sum + r.loss, 0);
      const totalRow = collectionSheet.addRow({
        recordNo: '合计',
        tireCount: collectionRecords.reduce((sum, r) => sum + r.tireCount, 0),
        unloadingNetWeight: parseFloat(totalUnloadingWeight.toFixed(2)),
        loss: parseFloat(totalLoss.toFixed(2)),
      });
      totalRow.font = { bold: true };
    }

    // 转移记录工作表
    if (transferRecords.length > 0) {
      const transferSheet = workbook.addWorksheet('转移记录');
      transferSheet.columns = [
        { header: '记录编号', key: 'recordNo', width: 25 },
        { header: '日期', key: 'date', width: 12 },
        { header: '装车时间', key: 'loadingTime', width: 10 },
        { header: '卸车时间', key: 'unloadingTime', width: 10 },
        { header: '司机姓名', key: 'driverName', width: 12 },
        { header: '司机电话', key: 'driverPhone', width: 15 },
        { header: '车牌号', key: 'vehiclePlate', width: 12 },
        { header: '目的地', key: 'destination', width: 20 },
        { header: '轮胎条数', key: 'tireCount', width: 10 },
        { header: '装车净重（kg）', key: 'loadingNetWeight', width: 15 },
        { header: '毛重（kg）', key: 'grossWeight', width: 12 },
        { header: '皮重（kg）', key: 'tareWeight', width: 12 },
        { header: '卸车净重（kg）', key: 'unloadingNetWeight', width: 15 },
        { header: '折损（kg）', key: 'loss', width: 12 },
        { header: '磅单号', key: 'weighbridgeNo', width: 18 },
      ];

      transferSheet.getRow(1).eachCell((cell) => {
        cell.style = headerStyle;
      });
      transferSheet.getRow(1).height = 25;

      transferRecords.forEach((record) => {
        const row = transferSheet.addRow({
          recordNo: record.recordNo,
          date: formatDateCN(record.date),
          loadingTime: formatTimeCN(record.loadingTime),
          unloadingTime: formatTimeCN(record.unloadingTime),
          driverName: record.driverName,
          driverPhone: record.driverPhone,
          vehiclePlate: record.vehiclePlate,
          destination: record.destination,
          tireCount: record.tireCount,
          loadingNetWeight: record.loadingNetWeight,
          grossWeight: record.grossWeight,
          tareWeight: record.tareWeight,
          unloadingNetWeight: record.unloadingNetWeight,
          loss: record.loss,
          weighbridgeNo: record.weighbridgeNo,
        });
        row.eachCell((cell) => {
          cell.style = cellStyle;
        });
      });

      // 添加汇总行
      const totalUnloadingWeight = transferRecords.reduce((sum, r) => sum + r.unloadingNetWeight, 0);
      const totalLoss = transferRecords.reduce((sum, r) => sum + r.loss, 0);
      const totalRow = transferSheet.addRow({
        recordNo: '合计',
        tireCount: transferRecords.reduce((sum, r) => sum + r.tireCount, 0),
        unloadingNetWeight: parseFloat(totalUnloadingWeight.toFixed(2)),
        loss: parseFloat(totalLoss.toFixed(2)),
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

