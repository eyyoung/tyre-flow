import { NextRequest, NextResponse } from "next/server";
import { withMiddlewares, standardMiddlewares } from "@/lib/middleware";
import { formatDateCN } from "@/lib/timezone";
import { getTranslatedValue } from "@/lib/translations";
import ExcelJS from "exceljs";

// 记录类型定义
interface CollectionRecord {
  recordNo: string;
  date: Date;
  loadingTime: Date;
  unloadingTime: Date | null;
  driverName: string;
  driverPhone: string;
  vehiclePlate: string;
  storeName: string;
  tireCount: number;
  loadingNetWeight: number;
  unloadingNetWeight: number;
  loss: number;
}

interface TransferRecord {
  recordNo: string;
  date: Date;
  loadingTime: Date;
  unloadingTime: Date | null;
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
}

// 样式定义
const headerStyle: Partial<ExcelJS.Style> = {
  font: { bold: true, color: { argb: "FFFFFFFF" } },
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF1677FF" } },
  alignment: { horizontal: "center", vertical: "middle" },
  border: {
    top: { style: "thin" },
    left: { style: "thin" },
    bottom: { style: "thin" },
    right: { style: "thin" },
  },
};

const cellStyle: Partial<ExcelJS.Style> = {
  alignment: { horizontal: "left", vertical: "middle" },
  border: {
    top: { style: "thin" },
    left: { style: "thin" },
    bottom: { style: "thin" },
    right: { style: "thin" },
  },
};

// 多语言标签类型
interface Labels {
  recordNo: string;
  date: string;
  driverName: string;
  driverPhone: string;
  vehiclePlate: string;
  storeName: string;
  tireCount: string;
  loadingNetWeight: string;
  unloadingNetWeight: string;
  loss: string;
  destination: string;
  grossWeight: string;
  tareWeight: string;
  weighbridgeNo: string;
  total: string;
  collectionRecords: string;
  transferRecords: string;
  collectionSummary: string;
  transferSummary: string;
}

// 获取多语言标签
function getLabels(lang: string): Labels {
  return lang === 'zh' ? {
    recordNo: '记录编号',
    date: '日期',
    driverName: '司机姓名',
    driverPhone: '司机电话',
    vehiclePlate: '车牌号',
    storeName: '门店',
    tireCount: '轮胎条数',
    loadingNetWeight: '装车净重（kg）',
    unloadingNetWeight: '卸车净重（kg）',
    loss: '折损（kg）',
    destination: '目的地',
    grossWeight: '毛重（kg）',
    tareWeight: '皮重（kg）',
    weighbridgeNo: '磅单号',
    total: '合计',
    collectionRecords: '【收集记录】',
    transferRecords: '【转移记录】',
    collectionSummary: '收集记录汇总',
    transferSummary: '转移记录汇总',
  } : {
    recordNo: 'Record No.',
    date: 'Date',
    driverName: 'Driver Name',
    driverPhone: 'Driver Phone',
    vehiclePlate: 'Vehicle Plate',
    storeName: 'Store',
    tireCount: 'Tire Count',
    loadingNetWeight: 'Loading Net (kg)',
    unloadingNetWeight: 'Unloading Net (kg)',
    loss: 'Loss (kg)',
    destination: 'Destination',
    grossWeight: 'Gross (kg)',
    tareWeight: 'Tare (kg)',
    weighbridgeNo: 'Weighbridge No.',
    total: 'Total',
    collectionRecords: '【Collection Records】',
    transferRecords: '【Transfer Records】',
    collectionSummary: 'Collection Summary',
    transferSummary: 'Transfer Summary',
  };
}

// 添加收集记录到工作表的辅助函数
function addCollectionRecordsToSheet(
  sheet: ExcelJS.Worksheet,
  records: CollectionRecord[],
  labels: Labels,
  startRow: number = 1,
  addHeader: boolean = true
): number {
  if (addHeader) {
    sheet.columns = [
      { header: labels.recordNo, key: "recordNo", width: 25 },
      { header: labels.date, key: "date", width: 12 },
      { header: labels.driverName, key: "driverName", width: 12 },
      { header: labels.driverPhone, key: "driverPhone", width: 15 },
      { header: labels.vehiclePlate, key: "vehiclePlate", width: 12 },
      { header: labels.storeName, key: "storeName", width: 25 },
      { header: labels.tireCount, key: "tireCount", width: 10 },
      { header: labels.loadingNetWeight, key: "loadingNetWeight", width: 15 },
      { header: labels.unloadingNetWeight, key: "unloadingNetWeight", width: 15 },
      { header: labels.loss, key: "loss", width: 12 },
    ];
    sheet.getRow(startRow).eachCell((cell) => {
      cell.style = headerStyle;
    });
    sheet.getRow(startRow).height = 25;
  }

  records.forEach((record) => {
    const row = sheet.addRow({
      recordNo: record.recordNo,
      date: formatDateCN(record.date),
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
  if (records.length > 0) {
    const totalUnloadingWeight = records.reduce(
      (sum, r) => sum + r.unloadingNetWeight,
      0
    );
    const totalLoss = records.reduce((sum, r) => sum + r.loss, 0);
    const totalRow = sheet.addRow({
      recordNo: labels.total,
      tireCount: records.reduce((sum, r) => sum + r.tireCount, 0),
      unloadingNetWeight: parseFloat(totalUnloadingWeight.toFixed(2)),
      loss: parseFloat(totalLoss.toFixed(2)),
    });
    totalRow.font = { bold: true };
  }

  return sheet.rowCount;
}

// 添加转移记录到工作表的辅助函数
function addTransferRecordsToSheet(
  sheet: ExcelJS.Worksheet,
  records: TransferRecord[],
  labels: Labels,
  startRow: number = 1,
  addHeader: boolean = true
): number {
  if (addHeader) {
    sheet.columns = [
      { header: labels.recordNo, key: "recordNo", width: 25 },
      { header: labels.date, key: "date", width: 12 },
      { header: labels.driverName, key: "driverName", width: 12 },
      { header: labels.driverPhone, key: "driverPhone", width: 15 },
      { header: labels.vehiclePlate, key: "vehiclePlate", width: 12 },
      { header: labels.destination, key: "destination", width: 20 },
      { header: labels.tireCount, key: "tireCount", width: 10 },
      { header: labels.loadingNetWeight, key: "loadingNetWeight", width: 15 },
      { header: labels.grossWeight, key: "grossWeight", width: 12 },
      { header: labels.tareWeight, key: "tareWeight", width: 12 },
      { header: labels.unloadingNetWeight, key: "unloadingNetWeight", width: 15 },
      { header: labels.loss, key: "loss", width: 12 },
      { header: labels.weighbridgeNo, key: "weighbridgeNo", width: 18 },
    ];
    sheet.getRow(startRow).eachCell((cell) => {
      cell.style = headerStyle;
    });
    sheet.getRow(startRow).height = 25;
  }

  records.forEach((record) => {
    const row = sheet.addRow({
      recordNo: record.recordNo,
      date: formatDateCN(record.date),
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
  if (records.length > 0) {
    const totalUnloadingWeight = records.reduce(
      (sum, r) => sum + r.unloadingNetWeight,
      0
    );
    const totalLoss = records.reduce((sum, r) => sum + r.loss, 0);
    const totalRow = sheet.addRow({
      recordNo: labels.total,
      tireCount: records.reduce((sum, r) => sum + r.tireCount, 0),
      unloadingNetWeight: parseFloat(totalUnloadingWeight.toFixed(2)),
      loss: parseFloat(totalLoss.toFixed(2)),
    });
    totalRow.font = { bold: true };
  }

  return sheet.rowCount;
}

// 清理Sheet名称，移除Excel不允许的字符
function sanitizeSheetName(name: string): string {
  // Excel不允许: \ / * ? [ ] :
  return name.replace(/[\\/*?[\]:]/g, "_").substring(0, 31);
}

// 导出司机台账 Excel
export async function GET(request: NextRequest) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    try {
      const { searchParams } = new URL(request.url);
      const driverId = searchParams.get("driverId") || "";
      const collectionPointId = searchParams.get("collectionPointId") || "";
      const recordType = searchParams.get("recordType") || "all";
      const startDate = searchParams.get("startDate") || "";
      const endDate = searchParams.get("endDate") || "";
      const lang = searchParams.get("lang") || "zh";
      
      // 获取多语言标签
      const labels = getLabels(lang);

      // 构建日期条件
      // 用户输入的日期代表中国时区（UTC+8）的那一天
      // 使用固定的 +08:00 时区偏移，不依赖服务器时区设置
      const dateFilter: { gte?: Date; lte?: Date } = {};
      if (startDate) {
        // startDate 格式为 YYYY-MM-DD，代表中国时区的那一天的开始
        dateFilter.gte = new Date(startDate + "T00:00:00.000+08:00");
      }
      if (endDate) {
        // endDate 格式为 YYYY-MM-DD，代表中国时区的那一天的结束
        dateFilter.lte = new Date(endDate + "T23:59:59.999+08:00");
      }

      // 获取司机信息 - ctx.prisma 已自动带收集点权限过滤
      let driverInfo: { name: string; phone: string } | null = null;
      if (driverId) {
        const vehicle = await ctx.prisma.vehicle.findUnique({
          where: { id: driverId },
          select: { driverName: true, driverNameTranslations: true, driverPhone: true },
        });
        if (vehicle) {
          driverInfo = {
            name: getTranslatedValue(
              vehicle.driverName,
              vehicle.driverNameTranslations as Record<string, string> | null,
              lang
            ) || "",
            phone: vehicle.driverPhone || "",
          };
        }
      }

      // 获取收集记录 - ctx.prisma 已自动带收集点权限过滤
      let collectionRecords: CollectionRecord[] = [];

      if (recordType === "all" || recordType === "collection") {
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

        const records = await ctx.prisma.collectionRecord.findMany({
          where: collectionWhere,
          include: {
            vehicle: {
              select: { 
                plateNumber: true, 
                driverName: true, 
                driverNameTranslations: true,
                driverPhone: true,
              },
            },
            store: { 
              select: { 
                name: true,
                nameTranslations: true,
              } 
            },
          },
          orderBy: { collectionDate: "asc" },
        });

        collectionRecords = records.map((r: (typeof records)[number]) => ({
          recordNo: r.recordNo,
          date: r.collectionDate,
          loadingTime: r.loadingTime,
          unloadingTime: r.unloadingTime,
          driverName: getTranslatedValue(
            r.vehicle.driverName,
            r.vehicle.driverNameTranslations as Record<string, string> | null,
            lang
          ) || "",
          driverPhone: r.vehicle.driverPhone || "",
          vehiclePlate: r.vehicle.plateNumber,
          storeName: getTranslatedValue(
            r.store.name,
            r.store.nameTranslations as Record<string, string> | null,
            lang
          ),
          tireCount: r.tireCount,
          loadingNetWeight: r.loadingNetWeight,
          unloadingNetWeight: r.unloadingNetWeight,
          loss: r.loss,
        }));
      }

      // 获取转移记录 - ctx.prisma 已自动带收集点权限过滤
      let transferRecords: TransferRecord[] = [];

      if (recordType === "all" || recordType === "transfer") {
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

        const records = await ctx.prisma.transferRecord.findMany({
          where: transferWhere,
          include: {
            vehicle: {
              select: { 
                plateNumber: true, 
                driverName: true, 
                driverNameTranslations: true,
                driverPhone: true,
              },
            },
          },
          orderBy: { transferDate: "asc" },
        });

        transferRecords = records.map((r: (typeof records)[number]) => ({
          recordNo: r.recordNo,
          date: r.transferDate,
          // TransferRecord 只有 transferDate，用它作为时间参考
          loadingTime: r.transferDate,
          unloadingTime: null,
          driverName: getTranslatedValue(
            r.vehicle.driverName,
            r.vehicle.driverNameTranslations as Record<string, string> | null,
            lang
          ) || "",
          driverPhone: r.vehicle.driverPhone || "",
          vehiclePlate: r.vehicle.plateNumber,
          destination: r.destination,
          tireCount: r.tireCount,
          loadingNetWeight: r.loadingNetWeight,
          grossWeight: r.grossWeight,
          tareWeight: r.tareWeight,
          unloadingNetWeight: r.unloadingNetWeight,
          loss: r.loss,
          weighbridgeNo: r.weighbridgeNo || "",
        }));
      }

      // 创建工作簿
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Tyre Flow System";
      workbook.created = new Date();

      // 按司机分组
      const driverCollectionMap = new Map<string, CollectionRecord[]>();
      const driverTransferMap = new Map<string, TransferRecord[]>();
      const driverInfoMap = new Map<
        string,
        { name: string; phone: string; plate: string }
      >();

      // 分组收集记录
      collectionRecords.forEach((record) => {
        const key = record.vehiclePlate;
        if (!driverCollectionMap.has(key)) {
          driverCollectionMap.set(key, []);
        }
        driverCollectionMap.get(key)!.push(record);

        if (!driverInfoMap.has(key)) {
          driverInfoMap.set(key, {
            name: record.driverName,
            phone: record.driverPhone,
            plate: record.vehiclePlate,
          });
        }
      });

      // 分组转移记录
      transferRecords.forEach((record) => {
        const key = record.vehiclePlate;
        if (!driverTransferMap.has(key)) {
          driverTransferMap.set(key, []);
        }
        driverTransferMap.get(key)!.push(record);

        if (!driverInfoMap.has(key)) {
          driverInfoMap.set(key, {
            name: record.driverName,
            phone: record.driverPhone,
            plate: record.vehiclePlate,
          });
        }
      });

      // 1. 创建主表（收集记录汇总）
      if (collectionRecords.length > 0) {
        const mainCollectionSheet = workbook.addWorksheet(labels.collectionSummary);
        addCollectionRecordsToSheet(mainCollectionSheet, collectionRecords, labels);
      }

      // 2. 创建主表（转移记录汇总）
      if (transferRecords.length > 0) {
        const mainTransferSheet = workbook.addWorksheet(labels.transferSummary);
        addTransferRecordsToSheet(mainTransferSheet, transferRecords, labels);
      }

      // 3. 为每个司机创建独立的子表
      const allDriverPlates = new Set([
        ...driverCollectionMap.keys(),
        ...driverTransferMap.keys(),
      ]);

      // 按车牌号排序
      const sortedPlates = Array.from(allDriverPlates).sort();

      for (const plate of sortedPlates) {
        const info = driverInfoMap.get(plate);
        const driverCollection = driverCollectionMap.get(plate) || [];
        const driverTransfer = driverTransferMap.get(plate) || [];

        // 只有在有记录时才创建子表
        if (driverCollection.length === 0 && driverTransfer.length === 0) {
          continue;
        }

        // 使用司机姓名和车牌号作为Sheet名
        const sheetName = sanitizeSheetName(
          info?.name ? `${info.name}(${plate})` : plate
        );

        const driverSheet = workbook.addWorksheet(sheetName);

        // 如果同时有收集和转移记录，在同一个Sheet中展示
        let currentRow = 1;

        // 添加收集记录
        if (driverCollection.length > 0) {
          // 添加标题
          const titleRow = driverSheet.getRow(currentRow);
          titleRow.getCell(1).value = labels.collectionRecords;
          titleRow.getCell(1).font = { bold: true, size: 14 };
          titleRow.height = 25;
          currentRow++;

          // 设置列
          driverSheet.columns = [
            { key: "recordNo", width: 25 },
            { key: "date", width: 12 },
            { key: "driverName", width: 12 },
            { key: "driverPhone", width: 15 },
            { key: "vehiclePlate", width: 12 },
            { key: "storeName", width: 25 },
            { key: "tireCount", width: 10 },
            { key: "loadingNetWeight", width: 15 },
            { key: "unloadingNetWeight", width: 15 },
            { key: "loss", width: 12 },
          ];

          // 添加表头
          const headerRowCollection = driverSheet.getRow(currentRow);
          headerRowCollection.values = [
            labels.recordNo,
            labels.date,
            labels.driverName,
            labels.driverPhone,
            labels.vehiclePlate,
            labels.storeName,
            labels.tireCount,
            labels.loadingNetWeight,
            labels.unloadingNetWeight,
            labels.loss,
          ];
          headerRowCollection.eachCell((cell) => {
            cell.style = headerStyle;
          });
          headerRowCollection.height = 25;
          currentRow++;

          // 添加数据行
          driverCollection.forEach((record) => {
            const row = driverSheet.getRow(currentRow);
            row.values = [
              record.recordNo,
              formatDateCN(record.date),
              record.driverName,
              record.driverPhone,
              record.vehiclePlate,
              record.storeName,
              record.tireCount,
              record.loadingNetWeight,
              record.unloadingNetWeight,
              record.loss,
            ];
            row.eachCell((cell) => {
              cell.style = cellStyle;
            });
            currentRow++;
          });

          // 添加汇总行
          const totalUnloadingWeight = driverCollection.reduce(
            (sum, r) => sum + r.unloadingNetWeight,
            0
          );
          const totalLoss = driverCollection.reduce((sum, r) => sum + r.loss, 0);
          const totalRow = driverSheet.getRow(currentRow);
          totalRow.getCell(1).value = labels.total;
          totalRow.getCell(7).value = driverCollection.reduce(
            (sum, r) => sum + r.tireCount,
            0
          );
          totalRow.getCell(9).value = parseFloat(totalUnloadingWeight.toFixed(2));
          totalRow.getCell(10).value = parseFloat(totalLoss.toFixed(2));
          totalRow.font = { bold: true };
          currentRow += 2; // 空一行
        }

        // 添加转移记录
        if (driverTransfer.length > 0) {
          // 添加标题
          const titleRow = driverSheet.getRow(currentRow);
          titleRow.getCell(1).value = labels.transferRecords;
          titleRow.getCell(1).font = { bold: true, size: 14 };
          titleRow.height = 25;
          currentRow++;

          // 添加表头
          const headerRowTransfer = driverSheet.getRow(currentRow);
          headerRowTransfer.values = [
            labels.recordNo,
            labels.date,
            labels.driverName,
            labels.driverPhone,
            labels.vehiclePlate,
            labels.destination,
            labels.tireCount,
            labels.loadingNetWeight,
            labels.grossWeight,
            labels.tareWeight,
            labels.unloadingNetWeight,
            labels.loss,
            labels.weighbridgeNo,
          ];
          headerRowTransfer.eachCell((cell) => {
            cell.style = headerStyle;
          });
          headerRowTransfer.height = 25;
          currentRow++;

          // 添加数据行
          driverTransfer.forEach((record) => {
            const row = driverSheet.getRow(currentRow);
            row.values = [
              record.recordNo,
              formatDateCN(record.date),
              record.driverName,
              record.driverPhone,
              record.vehiclePlate,
              record.destination,
              record.tireCount,
              record.loadingNetWeight,
              record.grossWeight,
              record.tareWeight,
              record.unloadingNetWeight,
              record.loss,
              record.weighbridgeNo,
            ];
            row.eachCell((cell) => {
              cell.style = cellStyle;
            });
            currentRow++;
          });

          // 添加汇总行
          const totalUnloadingWeight = driverTransfer.reduce(
            (sum, r) => sum + r.unloadingNetWeight,
            0
          );
          const totalLoss = driverTransfer.reduce((sum, r) => sum + r.loss, 0);
          const totalRow = driverSheet.getRow(currentRow);
          totalRow.getCell(1).value = labels.total;
          totalRow.getCell(7).value = driverTransfer.reduce(
            (sum, r) => sum + r.tireCount,
            0
          );
          totalRow.getCell(11).value = parseFloat(
            totalUnloadingWeight.toFixed(2)
          );
          totalRow.getCell(12).value = parseFloat(totalLoss.toFixed(2));
          totalRow.font = { bold: true };
        }
      }

      // 生成文件
      const buffer = await workbook.xlsx.writeBuffer();

      // 文件名
      const dateRange =
        startDate && endDate
          ? `${startDate}_${endDate}`
          : new Date().toISOString().slice(0, 10);
      
      const fileNameLabels = lang === 'zh' ? {
        driverLedger: '司机台账',
        allDrivers: '全部司机',
        allRecords: '全部记录',
        collectionRecords: '收集记录',
        transferRecords: '转移记录',
      } : {
        driverLedger: 'Driver_Ledger',
        allDrivers: 'All_Drivers',
        allRecords: 'All_Records',
        collectionRecords: 'Collection_Records',
        transferRecords: 'Transfer_Records',
      };
      
      const driverName = driverInfo?.name || fileNameLabels.allDrivers;
      const recordTypeLabel =
        recordType === "all"
          ? fileNameLabels.allRecords
          : recordType === "collection"
          ? fileNameLabels.collectionRecords
          : fileNameLabels.transferRecords;
      const fileName = `${fileNameLabels.driverLedger}_${driverName}_${dateRange}_${recordTypeLabel}.xlsx`;
      const encodedFileName = encodeURIComponent(fileName);

      return new NextResponse(buffer, {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodedFileName}`,
        },
      });
    } catch (error) {
      console.error("Export driver ledger error:", error);
      return NextResponse.json({ error: "导出司机台账失败" }, { status: 500 });
    }
  });
}
