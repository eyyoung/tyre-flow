import { NextRequest, NextResponse } from "next/server";
import { withMiddlewares, standardMiddlewares } from "@/lib/middleware";
import * as fs from "fs";
import * as path from "path";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import JSZip from "jszip";
import dayjs from "dayjs";
import { convertDocxToPdf } from "@/lib/docx-to-pdf";
import sizeOf from "image-size";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ImageModule = require("docxtemplater-image-module-free");

// 签名生成服务地址
const SIGNATURE_SERVICE_URL =
  process.env.SIGNATURE_SERVICE_URL || "http://localhost:3333/generate";

/**
 * 将 base64 Data URL 转换为 ArrayBuffer
 * 来源: https://github.com/evilc0des/docxtemplater-image-module-free
 */
function base64DataURLToArrayBuffer(dataURL: string): ArrayBuffer | false {
  const base64Regex = /^data:image\/(png|jpg|jpeg|svg|svg\+xml);base64,/;
  if (!base64Regex.test(dataURL)) {
    return false;
  }
  const stringBase64 = dataURL.replace(base64Regex, "");
  const binaryString = Buffer.from(stringBase64, "base64").toString("binary");
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    const ascii = binaryString.charCodeAt(i);
    bytes[i] = ascii;
  }
  return bytes.buffer;
}

// 每个合并文档包含的最大门店数量
const BATCH_SIZE = 500;

/**
 * 调用签名生成服务获取签名图片
 * @param name 签名人姓名
 * @returns 签名图片的 Data URL 字符串 (data:image/png;base64,xxx)
 */
async function generateSignature(name: string): Promise<string | null> {
  try {
    const response = await fetch(SIGNATURE_SERVICE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, stroke_scale: Math.random() * 0.1 + 0.9 }),
    });

    if (!response.ok) {
      console.error(
        `Signature service error: ${response.status} ${response.statusText}`
      );
      return null;
    }

    // 签名服务返回 JSON 格式：{ font: "xxx.ttf", image: "base64..." }
    const data = await response.json();

    if (!data.image) {
      console.error("Signature service response missing image field");
      return null;
    }

    // 获取 base64 数据
    let base64Data = data.image;
    // 如果已经有 data URI 前缀，去掉它
    if (base64Data.includes(",")) {
      base64Data = base64Data.split(",")[1];
    }

    // 返回完整的 Data URL 格式
    return `data:image/png;base64,${base64Data}`;
  } catch (error) {
    console.error("Failed to generate signature:", error);
    return null;
  }
}

// Word XML 命名空间
const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/**
 * 从 document.xml 中提取 body 内容（不包含 sectPr）
 */
function extractBodyContent(documentXml: string): string {
  // 匹配 <w:body>...</w:body> 中的内容
  const bodyMatch = documentXml.match(/<w:body[^>]*>([\s\S]*)<\/w:body>/);
  if (!bodyMatch) return "";

  let bodyContent = bodyMatch[1];

  // 移除最后的 sectPr（节属性，包含页面设置等）
  // sectPr 通常在 body 的最后，我们只保留第一个文档的 sectPr
  bodyContent = bodyContent.replace(/<w:sectPr[\s\S]*?<\/w:sectPr>\s*$/, "");

  return bodyContent;
}

/**
 * 获取文档的 sectPr（节属性）
 */
function extractSectPr(documentXml: string): string {
  const match = documentXml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/);
  return match ? match[0] : "";
}

/**
 * 生成分页符 XML
 */
function createPageBreak(): string {
  return `<w:p xmlns:w="${WORD_NS}"><w:r><w:br w:type="page"/></w:r></w:p>`;
}

/**
 * 合并多个 Word 文档为一个（基于 XML 操作，更可靠）
 * 使用第一个文档作为基础，保留其样式和设置
 * 正确处理每个文档中的图片资源
 */
function mergeDocxFiles(docxBuffers: Buffer[]): Buffer {
  if (docxBuffers.length === 0) {
    throw new Error("No documents to merge");
  }

  if (docxBuffers.length === 1) {
    return docxBuffers[0];
  }

  // 使用第一个文档作为基础
  const baseZip = new PizZip(docxBuffers[0]);
  const baseDocXml = baseZip.file("word/document.xml")?.asText();

  if (!baseDocXml) {
    throw new Error("Invalid base document");
  }

  // 提取基础文档的 body 内容和 sectPr
  const baseBodyContent = extractBodyContent(baseDocXml);
  const baseSectPr = extractSectPr(baseDocXml);

  // 收集所有文档的 body 内容
  const allBodyContents: string[] = [baseBodyContent];

  // 跟踪图片资源，用于重命名避免冲突
  let imageCounter = 1;
  // 获取基础文档已有的图片数量
  const baseMediaFiles = Object.keys(baseZip.files).filter((f) =>
    f.startsWith("word/media/")
  );
  imageCounter = baseMediaFiles.length + 1;

  // 读取基础文档的 relationships
  let baseRelsXml =
    baseZip.file("word/_rels/document.xml.rels")?.asText() || "";

  for (let i = 1; i < docxBuffers.length; i++) {
    try {
      const docZip = new PizZip(docxBuffers[i]);
      const docXml = docZip.file("word/document.xml")?.asText();

      if (docXml) {
        let bodyContent = extractBodyContent(docXml);

        // 处理这个文档中的图片
        const mediaFiles = Object.keys(docZip.files).filter((f) =>
          f.startsWith("word/media/")
        );

        // 读取这个文档的 relationships 来找到图片引用
        const docRelsXml =
          docZip.file("word/_rels/document.xml.rels")?.asText() || "";

        for (const mediaPath of mediaFiles) {
          const oldFileName = mediaPath.split("/").pop() || "";
          const extension = oldFileName.split(".").pop() || "png";
          const newFileName = `image${imageCounter}.${extension}`;
          const newMediaPath = `word/media/${newFileName}`;

          // 复制图片到基础文档
          const mediaContent = docZip.file(mediaPath)?.asUint8Array();
          if (mediaContent) {
            baseZip.file(newMediaPath, mediaContent);
          }

          // 找到旧的 relationship ID
          const oldRelMatch = docRelsXml.match(
            new RegExp(
              `<Relationship[^>]*Target="media/${oldFileName}"[^>]*Id="([^"]+)"`,
              "i"
            )
          );
          if (!oldRelMatch) {
            // 尝试另一种格式
            const altMatch = docRelsXml.match(
              new RegExp(
                `<Relationship[^>]*Id="([^"]+)"[^>]*Target="media/${oldFileName}"`,
                "i"
              )
            );
            if (altMatch) {
              const oldRelId = altMatch[1];
              const newRelId = `rId${1000 + imageCounter}`;

              // 更新 body 内容中的引用
              bodyContent = bodyContent.replace(
                new RegExp(`r:embed="${oldRelId}"`, "g"),
                `r:embed="${newRelId}"`
              );

              // 添加新的 relationship
              const newRel = `<Relationship Id="${newRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${newFileName}"/>`;
              baseRelsXml = baseRelsXml.replace(
                "</Relationships>",
                `${newRel}</Relationships>`
              );
            }
          } else {
            const oldRelId = oldRelMatch[1];
            const newRelId = `rId${1000 + imageCounter}`;

            // 更新 body 内容中的引用
            bodyContent = bodyContent.replace(
              new RegExp(`r:embed="${oldRelId}"`, "g"),
              `r:embed="${newRelId}"`
            );

            // 添加新的 relationship
            const newRel = `<Relationship Id="${newRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${newFileName}"/>`;
            baseRelsXml = baseRelsXml.replace(
              "</Relationships>",
              `${newRel}</Relationships>`
            );
          }

          imageCounter++;
        }

        if (bodyContent) {
          allBodyContents.push(bodyContent);
        }
      }
    } catch (error) {
      console.error(`Error processing document ${i}:`, error);
    }
  }

  // 用分页符连接所有内容
  const mergedBodyContent = allBodyContents.join(createPageBreak());

  // 重建 document.xml
  const xmlDeclaration =
    baseDocXml.match(/<\?xml[^?]*\?>/)?.[0] ||
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const documentStart =
    baseDocXml.match(/<w:document[^>]*>/)?.[0] || "<w:document>";

  const mergedDocXml = `${xmlDeclaration}
${documentStart}
<w:body>${mergedBodyContent}${baseSectPr}</w:body>
</w:document>`;

  // 更新 ZIP 中的文件
  baseZip.file("word/document.xml", mergedDocXml);
  baseZip.file("word/_rels/document.xml.rels", baseRelsXml);

  // 生成合并后的文档
  return baseZip.generate({
    type: "nodebuffer",
    compression: "DEFLATE",
  }) as Buffer;
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
  templateContent: string,
  signatureDataURL: string | null // 签名图片的 Data URL (data:image/png;base64,xxx)
): Promise<Buffer> {
  // 创建新的 PizZip 实例
  const zipDoc = new PizZip(templateContent);

  // 配置图片模块（按照 GitHub 文档的方式）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modules: any[] = [];
  if (signatureDataURL) {
    try {
      const imageModuleOptions = {
        centered: false,
        fileType: "docx",
        getImage: (tagValue: string) => {
          const result = base64DataURLToArrayBuffer(tagValue);
          if (result === false) {
            throw new Error("Invalid image data URL");
          }
          return result;
        },
        getSize: (img: ArrayBuffer): [number, number] => {
          const buffer = Buffer.from(img);
          const dimensions = sizeOf(buffer);
          const width = dimensions.width || 150;
          const height = dimensions.height || 50;
          // 固定高度 40，按比例计算宽度
          return [(40 * width) / height, 40];
        },
      };
      modules.push(new ImageModule(imageModuleOptions));
    } catch (e) {
      console.error("[ImageModule] Failed to create module:", e);
    }
  }

  // 创建 Docxtemplater 实例
  const doc = new Docxtemplater(zipDoc, {
    paragraphLoop: true,
    linebreaks: true,
    modules,
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
  const fullAddress = store.address;

  // 构建渲染数据
  const renderData: Record<string, unknown> = {
    storeName: store.name,
    legalPerson: store.legalPerson || "-",
    address: fullAddress || store.address,
    postcodeCity: postcodeCity,
    country: "China",
    collectionPoint: collectionPoint.companyName || collectionPoint.name,
    placeDate: placeDate,
  };

  // 只有当签名图片存在时才添加（传入 Data URL 字符串）
  if (signatureDataURL) {
    renderData.signature = signatureDataURL;
  }

  // 填充数据
  doc.render(renderData);

  // 生成文件
  return doc.getZip().generate({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
}

// 导出 ISCC 声明
export async function GET(request: NextRequest) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    try {
      const { searchParams } = new URL(request.url);
      const collectionPointId = searchParams.get("collectionPointId");
      const storeId = searchParams.get("storeId");

      // 读取 Word 模板
      const templatePath = path.join(process.cwd(), "template", "ISCC.docx");
      const templateContent = fs.readFileSync(templatePath, "binary");

      // 单个门店导出
      if (storeId) {
        const store = await ctx.prisma.store.findUnique({
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

        // 生成签名图片 Data URL
        const signatureName = store.legalPerson || store.name;
        const signatureDataURL = await generateSignature(signatureName);

        const docxBuf = await generateIsccDocument(
          store,
          store.collectionPoint,
          templateContent,
          signatureDataURL
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

      // 获取收集点信息（通过 ctx.prisma 自动应用收集点过滤）
      const collectionPoint = await ctx.prisma.collectionPoint.findUnique({
        where: { id: collectionPointId },
      });

      if (!collectionPoint) {
        return NextResponse.json(
          { message: "Collection point not found" },
          { status: 404 }
        );
      }

      // 获取所有活跃且非虚拟的门店（通过 ctx.prisma 自动应用收集点过滤）
      const stores = await ctx.prisma.store.findMany({
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

      console.log(
        `[ISCC Export] Testing with ${stores.length} stores (limited for testing)`
      );

      const currentDate = dayjs().format("YYYY-MM-DD");

      // 第一步：为每个门店生成 Word 文档
      console.log(
        `[ISCC Export] Generating ${stores.length} Word documents...`
      );
      const docxBuffers: Buffer[] = [];

      // 缓存已生成的签名，避免重复请求相同姓名的签名
      const signatureCache = new Map<string, string | null>();

      for (const store of stores) {
        try {
          // 生成或从缓存获取签名
          const signatureName = store.legalPerson || store.name;
          let signatureDataURL: string | null;

          if (signatureCache.has(signatureName)) {
            signatureDataURL = signatureCache.get(signatureName) || null;
          } else {
            signatureDataURL = await generateSignature(signatureName);
            signatureCache.set(signatureName, signatureDataURL);
          }

          const docxBuf = await generateIsccDocument(
            store,
            collectionPoint,
            templateContent,
            signatureDataURL
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
          `[ISCC Export] Processing batch ${batchIndex + 1}/${totalBatches} (${
            batchDocx.length
          } docs)...`
        );

        try {
          // 合并这一批的 Word 文档
          const mergedDocx = await mergeDocxFiles(batchDocx);

          // 将合并后的 Word 转换为 PDF（只调用一次 LibreOffice）
          const pdfBuf = await convertDocxToPdf(mergedDocx);

          const batchName =
            totalBatches === 1
              ? `ISCC_${collectionPoint.name}_${currentDate}.pdf`
              : `ISCC_${collectionPoint.name}_${currentDate}_${
                  batchIndex + 1
                }.pdf`;

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
