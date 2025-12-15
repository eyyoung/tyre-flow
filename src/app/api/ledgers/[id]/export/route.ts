import { NextRequest, NextResponse } from "next/server";
import { withMiddlewares, standardMiddlewares } from "@/lib/middleware";
import { formatDateCN } from "@/lib/timezone";
import ExcelJS from "exceljs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// 导出台账数据
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "collection"; // collection only (transfer moved to TransferTask)
    const lang = searchParams.get("lang") || "zh"; // zh | en

    try {
      // 获取任务信息（通过 ctx.prisma 自动应用收集点过滤）
      const task = await ctx.prisma.ledgerTask.findUnique({
        where: { id },
        include: {
          collectionPoint: true,
        },
      });

      if (!task) {
        return NextResponse.json(
          { message: "Task not found" },
          { status: 404 }
        );
      }

      // 创建工作簿
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Tyre Flow System";
      workbook.created = new Date();

      // 多语言标签
      const labels = {
        zh: {
          collectionSheet: "收集台账",
          transferSheet: "转移台账",
          date: "日期",
          storeName: "门店名称",
          storeAddress: "门店地址",
          vehiclePlate: "车牌号",
          tireCount: "轮胎条数",
          loadingNetWeight: "装车净重（kg）",
          unloadingNetWeight: "卸车净重（kg）",
          loss: "折损（kg）",
          remarks: "备注",
          total: "合计",
        },
        en: {
          collectionSheet: "Collection Ledger",
          transferSheet: "Transfer Ledger",
          date: "Date",
          storeName: "Store Name",
          storeAddress: "Store Address",
          vehiclePlate: "Vehicle Plate",
          tireCount: "Tire Count",
          loadingNetWeight: "Loading Net Weight (kg)",
          unloadingNetWeight: "Unloading Net Weight (kg)",
          loss: "Loss (kg)",
          remarks: "Remarks",
          total: "Total",
        },
      };

      const l = labels[lang as keyof typeof labels] || labels.zh;

      // 门店统计表多语言标签
      const storeStatsLabels = {
        zh: {
          sheetName: "门店统计",
          storeName: "门店名称",
          total: "合计",
        },
        en: {
          sheetName: "Store Statistics",
          storeName: "Store Name",
          total: "Total",
        },
      };
      const sl =
        storeStatsLabels[lang as keyof typeof storeStatsLabels] ||
        storeStatsLabels.zh;

      // 设置单元格样式
      const headerStyle: Partial<ExcelJS.Style> = {
        font: { bold: true, color: { argb: "FFFFFFFF" } },
        fill: {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF1677FF" },
        },
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

      // 收集台账
      if (type === "all" || type === "collection") {
        const collectionRecords = await ctx.prisma.collectionRecord.findMany({
          where: { taskId: id },
          include: {
            store: { select: { code: true, name: true, address: true } },
            vehicle: { select: { plateNumber: true } },
          },
          orderBy: { collectionDate: "asc" },
        });

        const collectionSheet = workbook.addWorksheet(l.collectionSheet);

        // 设置列宽
        collectionSheet.columns = [
          { header: l.date, key: "date", width: 15 },
          { header: l.storeName, key: "storeName", width: 45 },
          { header: l.vehiclePlate, key: "vehiclePlate", width: 15 },
          { header: l.tireCount, key: "tireCount", width: 12 },
          { header: l.loadingNetWeight, key: "loadingNetWeight", width: 18 },
          {
            header: l.unloadingNetWeight,
            key: "unloadingNetWeight",
            width: 18,
          },
          { header: l.loss, key: "loss", width: 15 },
          { header: l.remarks, key: "remarks", width: 20 },
          { header: l.storeAddress, key: "storeAddress", width: 40 },
        ];

        // 设置表头样式
        collectionSheet.getRow(1).eachCell((cell) => {
          cell.style = headerStyle;
        });
        collectionSheet.getRow(1).height = 25;

        // 添加数据
        collectionRecords.forEach((record: (typeof collectionRecords)[number]) => {
          const row = collectionSheet.addRow({
            date: formatDateCN(record.collectionDate),
            storeName: record.store.name,
            vehiclePlate: record.vehicle.plateNumber,
            tireCount: record.tireCount,
            loadingNetWeight: record.loadingNetWeight,
            unloadingNetWeight: record.unloadingNetWeight,
            loss: record.loss,
            remarks: record.remarks || "",
            storeAddress: record.store.address,
          });
          row.eachCell((cell) => {
            cell.style = cellStyle;
          });
        });

        // 添加汇总行
        type CollectionRecord = (typeof collectionRecords)[number];
        const totalTireCount = collectionRecords.reduce(
          (sum: number, r: CollectionRecord) => sum + r.tireCount,
          0
        );
        const totalLoadingNetWeight = collectionRecords.reduce(
          (sum: number, r: CollectionRecord) => sum + (r.loadingNetWeight || 0),
          0
        );
        const totalUnloadingNetWeight = collectionRecords.reduce(
          (sum: number, r: CollectionRecord) => sum + (r.unloadingNetWeight || 0),
          0
        );

        const summaryRow = collectionSheet.addRow({
          date: l.total,
          storeName: "",
          vehiclePlate: "",
          tireCount: totalTireCount,
          loadingNetWeight: totalLoadingNetWeight,
          unloadingNetWeight: totalUnloadingNetWeight,
          loss: "",
          remarks: "",
          storeAddress: "",
        });
        summaryRow.eachCell((cell) => {
          cell.style = {
            ...cellStyle,
            font: { bold: true },
            fill: {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFF0F0F0" },
            },
          };
        });

        // 门店统计表：以门店为维度，纵轴门店，横轴日期，单元格为轮胎条数
        if (collectionRecords.length > 0) {
          const storeStatsSheet = workbook.addWorksheet(sl.sheetName);

          // 获取所有唯一日期并排序
          const dateSet = new Set<string>();
          collectionRecords.forEach((record: CollectionRecord) => {
            dateSet.add(formatDateCN(record.collectionDate));
          });
          const sortedDates = Array.from(dateSet).sort();

          // 获取所有唯一门店并排序
          const storeMap = new Map<
            string,
            { name: string; dateData: Map<string, number> }
          >();
          collectionRecords.forEach((record: CollectionRecord) => {
            const storeId = record.storeId;
            const dateStr = formatDateCN(record.collectionDate);

            if (!storeMap.has(storeId)) {
              storeMap.set(storeId, {
                name: record.store.name,
                dateData: new Map(),
              });
            }

            const storeData = storeMap.get(storeId)!;
            const currentCount = storeData.dateData.get(dateStr) || 0;
            storeData.dateData.set(dateStr, currentCount + record.tireCount);
          });

          // 按门店名称排序
          const sortedStores = Array.from(storeMap.entries()).sort((a, b) =>
            a[1].name.localeCompare(b[1].name, "zh-CN")
          );

          // 设置列：第一列是门店名称，后面是日期列，最后是合计列
          const columns: Partial<ExcelJS.Column>[] = [
            { header: sl.storeName, key: "storeName", width: 45 },
          ];
          sortedDates.forEach((date) => {
            columns.push({ header: date, key: date, width: 12 });
          });
          columns.push({ header: sl.total, key: "total", width: 12 });
          storeStatsSheet.columns = columns;

          // 设置表头样式
          storeStatsSheet.getRow(1).eachCell((cell) => {
            cell.style = headerStyle;
          });
          storeStatsSheet.getRow(1).height = 25;

          // 添加数据行
          sortedStores.forEach(([, storeData]) => {
            const rowData: Record<string, string | number> = {
              storeName: storeData.name,
            };
            let storeTotal = 0;
            sortedDates.forEach((date) => {
              const count = storeData.dateData.get(date) || 0;
              rowData[date] = count || "";
              storeTotal += count;
            });
            rowData["total"] = storeTotal;

            const row = storeStatsSheet.addRow(rowData);
            row.eachCell((cell, colNumber) => {
              if (colNumber === columns.length) {
                // 合计列样式
                cell.style = {
                  ...cellStyle,
                  font: { bold: true },
                  alignment: { horizontal: "center", vertical: "middle" },
                };
              } else if (colNumber > 1) {
                // 数据列居中
                cell.style = {
                  ...cellStyle,
                  alignment: { horizontal: "center", vertical: "middle" },
                };
              } else {
                cell.style = cellStyle;
              }
            });
          });

          // 添加日期汇总行
          const dateTotals: Record<string, string | number> = {
            storeName: sl.total,
          };
          let grandTotal = 0;
          sortedDates.forEach((date) => {
            let dateTotal = 0;
            sortedStores.forEach(([, storeData]) => {
              dateTotal += storeData.dateData.get(date) || 0;
            });
            dateTotals[date] = dateTotal;
            grandTotal += dateTotal;
          });
          dateTotals["total"] = grandTotal;

          const totalRow = storeStatsSheet.addRow(dateTotals);
          totalRow.eachCell((cell) => {
            cell.style = {
              ...cellStyle,
              font: { bold: true },
              fill: {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "FFF0F0F0" },
              },
              alignment: { horizontal: "center", vertical: "middle" },
            };
          });
          // 第一列（门店名称/合计）左对齐
          totalRow.getCell(1).style = {
            ...cellStyle,
            font: { bold: true },
            fill: {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFF0F0F0" },
            },
          };
        }
      }

      // 转移台账已移至独立的 TransferTask，此处不再导出

      // 生成 Excel 文件
      const buffer = await workbook.xlsx.writeBuffer();

      // 设置文件名
      const startDateStr = formatDateCN(task.startDate);
      const endDateStr = formatDateCN(task.endDate);
      const fileName = `${task.collectionPoint.name}_${startDateStr}_${endDateStr}_收集台账.xlsx`;
      const encodedFileName = encodeURIComponent(fileName);

      return new NextResponse(buffer, {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodedFileName}`,
        },
      });
    } catch (error) {
      console.error("Export ledger error:", error);
      return NextResponse.json(
        { message: "Internal server error" },
        { status: 500 }
      );
    }
  });
}
