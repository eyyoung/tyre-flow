import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { withAuth } from "@/lib/auth";
import * as fs from "fs";
import * as path from "path";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import JSZip from "jszip";
import dayjs from "dayjs";
import { convertDocxToPdf } from "@/lib/docx-to-pdf";
// @ts-expect-error docx-merger has no type definitions
import DocxMerger from "docx-merger";

// 每个合并文档包含的最大门店数量
const BATCH_SIZE = 500;

/**
 * 合并多个 Word 文档为一个
 */
async function mergeDocxFiles(docxBuffers: Buffer[]): Promise<Buffer> {
  return new Promise((resolve) => {
    const docxMerger = new DocxMerger(
      { pageBreak: true }, // 每个文档之间插入分页符
      docxBuffers
    );
    docxMerger.save("nodebuffer", (data: Buffer) => {
      resolve(data);
    });
  });
}

// 生成单个门店的 ISCC 声明 Word 文件
async function generateIsccDocument(
  store: {
    code: string;
    name: string;
    legalPerson: string | null;
    address: string;
    province: string | null;
    city: string | null;
    district: string | null;
    createdAt: Date;
  },
  collectionPoint: {
    name: string;
    companyName: string | null;
    city: string | null;
    province: string | null;
    postcode: string | null;
  },
  templateContent: string
): Promise<Buffer> {
  // 创建新的 PizZip 实例
  const zipDoc = new PizZip(templateContent);

  // 创建 Docxtemplater 实例
  const doc = new Docxtemplater(zipDoc, {
    paragraphLoop: true,
    linebreaks: true,
  });

  // 使用门店导入时间，格式为 yyyy/mm/dd
  const importDate = dayjs(store.createdAt).format("YYYY/MM/DD");
  // 地点精确到市
  const place = collectionPoint.city || collectionPoint.province || "China";
  const placeDate = `${place}, ${importDate}`;

  // 邮编+城市
  const postcodeCity =
    [collectionPoint.postcode, collectionPoint.city]
      .filter(Boolean)
      .join(", ") || "-";

  // 构造完整地址
  const fullAddress = [
    store.province,
    store.city,
    store.district,
    store.address,
  ]
    .filter(Boolean)
    .join(" ");

  // 填充数据（使用公司名，如果没有则回退到简称）
  doc.render({
    storeName: store.name,
    legalPerson: store.legalPerson || "-",
    address: fullAddress || store.address,
    postcodeCity: postcodeCity,
    country: "China",
    collectionPoint: collectionPoint.companyName || collectionPoint.name,
    placeDate: placeDate,
  });

  // 生成文件
  return doc.getZip().generate({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
}

// 导出 ISCC 声明
export async function GET(request: NextRequest) {
  return withAuth(request, async () => {
    try {
      const { searchParams } = new URL(request.url);
      const collectionPointId = searchParams.get("collectionPointId");
      const storeId = searchParams.get("storeId");

      // 读取 Word 模板
      const templatePath = path.join(process.cwd(), "template", "ISCC.docx");
      const templateContent = fs.readFileSync(templatePath, "binary");

      // 单个门店导出
      if (storeId) {
        const store = await prisma.store.findUnique({
          where: { id: storeId },
          include: {
            collectionPoint: true,
          },
        });

        if (!store) {
          return NextResponse.json(
            { message: "Store not found" },
            { status: 404 }
          );
        }

        const docxBuf = await generateIsccDocument(
          store,
          store.collectionPoint,
          templateContent
        );

        // 转换为 PDF
        const pdfBuf = await convertDocxToPdf(docxBuf);
        const fileName = `ISCC_${store.name.replace(
          /[/\\?%*:|"<>]/g,
          "_"
        )}.pdf`;

        return new NextResponse(new Uint8Array(pdfBuf), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${encodeURIComponent(
              fileName
            )}"`,
            "Content-Length": pdfBuf.length.toString(),
          },
        });
      }

      // 批量导出（按收集点）
      if (!collectionPointId) {
        return NextResponse.json(
          { message: "Collection point ID or Store ID is required" },
          { status: 400 }
        );
      }

      // 获取收集点信息
      const collectionPoint = await prisma.collectionPoint.findUnique({
        where: { id: collectionPointId },
      });

      if (!collectionPoint) {
        return NextResponse.json(
          { message: "Collection point not found" },
          { status: 404 }
        );
      }

      // 获取所有活跃且非虚拟的门店
      const stores = await prisma.store.findMany({
        where: {
          collectionPointId,
          status: "ACTIVE",
          isVirtual: false,
        },
        orderBy: { code: "asc" },
      });

      if (stores.length === 0) {
        return NextResponse.json(
          { message: "No stores found for this collection point" },
          { status: 404 }
        );
      }

      const currentDate = dayjs().format("YYYY-MM-DD");

      // 第一步：为每个门店生成 Word 文档
      console.log(`[ISCC Export] Generating ${stores.length} Word documents...`);
      const docxBuffers: Buffer[] = [];
      for (const store of stores) {
        try {
          const docxBuf = await generateIsccDocument(
            store,
            collectionPoint,
            templateContent
          );
          docxBuffers.push(docxBuf);
        } catch (error) {
          console.error(
            `Error generating ISCC Word for store ${store.code}:`,
            error
          );
          // 继续处理其他门店
        }
      }

      // 第二步：将 Word 文档分批合并，每批最多 BATCH_SIZE 个
      const totalBatches = Math.ceil(docxBuffers.length / BATCH_SIZE);
      console.log(
        `[ISCC Export] Merging into ${totalBatches} batch(es), ${BATCH_SIZE} docs per batch...`
      );

      const mergedPdfs: { name: string; buffer: Buffer }[] = [];

      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const startIdx = batchIndex * BATCH_SIZE;
        const endIdx = Math.min(startIdx + BATCH_SIZE, docxBuffers.length);
        const batchDocx = docxBuffers.slice(startIdx, endIdx);

        console.log(
          `[ISCC Export] Processing batch ${batchIndex + 1}/${totalBatches} (${batchDocx.length} docs)...`
        );

        try {
          // 合并这一批的 Word 文档
          const mergedDocx = await mergeDocxFiles(batchDocx);

          // 将合并后的 Word 转换为 PDF（只调用一次 LibreOffice）
          const pdfBuf = await convertDocxToPdf(mergedDocx);

          const batchName =
            totalBatches === 1
              ? `ISCC_${collectionPoint.name}_${currentDate}.pdf`
              : `ISCC_${collectionPoint.name}_${currentDate}_${batchIndex + 1}.pdf`;

          mergedPdfs.push({
            name: batchName,
            buffer: pdfBuf,
          });
        } catch (error) {
          console.error(`Error processing batch ${batchIndex + 1}:`, error);
        }
      }

      if (mergedPdfs.length === 0) {
        return NextResponse.json(
          { message: "Failed to generate any PDF" },
          { status: 500 }
        );
      }

      // 如果只有一个合并后的 PDF，直接返回
      if (mergedPdfs.length === 1) {
        const { name, buffer } = mergedPdfs[0];
        return new NextResponse(new Uint8Array(buffer), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${encodeURIComponent(
              name
            )}"`,
            "Content-Length": buffer.length.toString(),
          },
        });
      }

      // 多个合并后的 PDF，打包成 ZIP
      const zip = new JSZip();
      for (const { name, buffer } of mergedPdfs) {
        zip.file(name, buffer);
      }

      const zipBuffer = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
        compressionOptions: { level: 9 },
      });

      const zipFileName = `ISCC_${collectionPoint.name}_${currentDate}.zip`;

      return new NextResponse(new Uint8Array(zipBuffer), {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(
            zipFileName
          )}"`,
          "Content-Length": zipBuffer.length.toString(),
        },
      });
    } catch (error) {
      console.error("Export ISCC error:", error);
      return NextResponse.json(
        { message: "Internal server error" },
        { status: 500 }
      );
    }
  });
}
