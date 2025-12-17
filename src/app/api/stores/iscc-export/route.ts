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

/**
 * 获取或创建门店的缓存签名
 * 如果数据库中存在签名缓存则直接返回，否则生成新签名并保存到数据库
 * @param prismaClient Prisma 客户端实例
 * @param storeId 门店ID
 * @param signatureFileId 现有签名文件ID（可能为null）
 * @param signatureName 签名人姓名（法人或门店名）
 * @returns 签名图片的 Data URL 字符串
 */
async function getOrCreateCachedSignature(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prismaClient: any,
  storeId: string,
  signatureFileId: string | null,
  signatureName: string
): Promise<string | null> {
  // 如果存在缓存的签名文件，从数据库读取
  if (signatureFileId) {
    try {
      const signatureFile = await prismaClient.signatureFile.findUnique({
        where: { id: signatureFileId },
      });

      if (signatureFile) {
        // 将 Bytes 转换为 Data URL
        const base64Data = Buffer.from(signatureFile.data).toString("base64");
        console.log(`[Signature Cache] Hit for store ${storeId}`);
        return `data:${signatureFile.mimeType};base64,${base64Data}`;
      }
    } catch (error) {
      console.error(`[Signature Cache] Error reading cache for store ${storeId}:`, error);
    }
  }

  // 缓存不存在，生成新签名
  console.log(`[Signature Cache] Miss for store ${storeId}, generating new signature...`);
  const signatureDataURL = await generateSignature(signatureName);

  if (!signatureDataURL) {
    return null;
  }

  // 提取 base64 数据并保存到数据库
  try {
    const base64Match = signatureDataURL.match(/^data:([^;]+);base64,(.+)$/);
    if (base64Match) {
      const mimeType = base64Match[1];
      const base64Data = base64Match[2];
      const binaryData = Buffer.from(base64Data, "base64");

      // 使用事务创建签名文件并更新门店关联
      await prismaClient.$transaction(async (tx: typeof prismaClient) => {
        const newSignatureFile = await tx.signatureFile.create({
          data: {
            data: binaryData,
            mimeType,
          },
        });

        await tx.store.update({
          where: { id: storeId },
          data: { signatureFileId: newSignatureFile.id },
        });
      });

      console.log(`[Signature Cache] Created and cached signature for store ${storeId}`);
    }
  } catch (error) {
    console.error(`[Signature Cache] Error saving cache for store ${storeId}:`, error);
    // 即使保存失败，仍然返回生成的签名供本次使用
  }

  return signatureDataURL;
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

/**
 * 计算 ISCC 签署日期
 * 优先级：1. 缓存的签署日期 -> 2. 第一次收集日期 -> 3. 随机生成（导入时间前15-45天）
 * @returns { signDate: Date, isNewlyCalculated: boolean }
 */
function calculateSignDate(
  cachedSignDate: Date | null | undefined,
  firstCollectionDate: Date | null | undefined,
  storeCreatedAt: Date
): { signDate: Date; isNewlyCalculated: boolean } {
  // 1. 优先使用缓存的签署日期
  if (cachedSignDate) {
    return { signDate: cachedSignDate, isNewlyCalculated: false };
  }

  // 2. 使用第一次收集日期
  if (firstCollectionDate) {
    return { signDate: firstCollectionDate, isNewlyCalculated: true };
  }

  // 3. 随机生成：导入时间往前15天到45天（半个月到一个半月）
  const daysBack = Math.floor(Math.random() * 31) + 15; // 15-45天
  const signDate = dayjs(storeCreatedAt).subtract(daysBack, "day").toDate();
  return { signDate, isNewlyCalculated: true };
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
  },
  collectionPoint: {
    name: string;
    companyName: string | null;
    city: string | null;
    province: string | null;
    postcode: string | null;
  },
  templateContent: string,
  signatureDataURL: string | null, // 签名图片的 Data URL (data:image/png;base64,xxx)
  signDate: Date // ISCC 签署日期
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

  // 使用传入的签署日期
  const importDate = dayjs(signDate).format("YYYY/MM/DD");
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

// SSE 事件类型定义
type SSEEvent =
  | { type: "start"; total: number }
  | { type: "generating"; current: number; total: number; storeName: string }
  | { type: "merging"; batch: number; totalBatches: number }
  | { type: "converting"; batch: number; totalBatches: number }
  | { type: "complete"; fileName: string; fileType: string; data: string }
  | { type: "error"; message: string };

// 创建 SSE 格式的消息
function formatSSE(event: SSEEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

// 导出 ISCC 声明（单个门店导出，保持原有 GET 方式）
export async function GET(request: NextRequest) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    try {
      const { searchParams } = new URL(request.url);
      const storeId = searchParams.get("storeId");

      if (!storeId) {
        return NextResponse.json(
          { message: "Store ID is required for GET request. Use POST for batch export." },
          { status: 400 }
        );
      }

      // 读取 Word 模板
      const templatePath = path.join(process.cwd(), "template", "ISCC.docx");
      const templateContent = fs.readFileSync(templatePath, "binary");

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

      // 计算签署日期（优先使用缓存，其次首次收集日期，最后随机生成）
      let firstCollectionDate: Date | null = null;
      if (!store.isccSignDate) {
        // 只有在没有缓存时才查询首次收集日期
        const firstCollectionRecord = await ctx.prisma.collectionRecord.findFirst({
          where: { storeId },
          orderBy: { loadingTime: "asc" },
          select: { loadingTime: true },
        });
        firstCollectionDate = firstCollectionRecord?.loadingTime ?? null;
      }

      const { signDate, isNewlyCalculated } = calculateSignDate(
        store.isccSignDate,
        firstCollectionDate,
        store.createdAt
      );

      // 如果是新计算的签署日期，保存到数据库缓存
      if (isNewlyCalculated) {
        await ctx.prisma.store.update({
          where: { id: storeId },
          data: { isccSignDate: signDate },
        });
      }

      // 获取或创建缓存的签名
      const signatureName = store.legalPerson || store.name;
      const signatureDataURL = await getOrCreateCachedSignature(
        ctx.prisma,
        store.id,
        store.signatureFileId,
        signatureName
      );

      const docxBuf = await generateIsccDocument(
        store,
        store.collectionPoint,
        templateContent,
        signatureDataURL,
        signDate
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
    } catch (error) {
      console.error("Export ISCC error:", error);
      return NextResponse.json(
        { message: "Internal server error" },
        { status: 500 }
      );
    }
  });
}

// 批量导出 ISCC 声明（SSE 方式，返回进度和最终文件）
export async function POST(request: NextRequest) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    const encoder = new TextEncoder();
    
    // 创建 ReadableStream 用于 SSE
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: SSEEvent) => {
          controller.enqueue(encoder.encode(formatSSE(event)));
        };

        try {
          const body = await request.json();
          const collectionPointId = body.collectionPointId;

          if (!collectionPointId) {
            send({ type: "error", message: "Collection point ID is required" });
            controller.close();
            return;
          }

          // 获取收集点信息（通过 ctx.prisma 自动应用收集点过滤）
          const collectionPoint = await ctx.prisma.collectionPoint.findUnique({
            where: { id: collectionPointId },
          });

          if (!collectionPoint) {
            send({ type: "error", message: "Collection point not found" });
            controller.close();
            return;
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
            send({ type: "error", message: "No stores found for this collection point" });
            controller.close();
            return;
          }

          // 发送开始事件
          send({ type: "start", total: stores.length });

          // 筛选出没有缓存签署日期的门店，只对这些门店查询首次收集日期
          const storesWithoutCachedDate = stores.filter(
            (s: { isccSignDate: Date | null }) => !s.isccSignDate
          );
          const storeIdsWithoutCachedDate = storesWithoutCachedDate.map(
            (s: { id: string }) => s.id
          );

          // 批量查询需要的门店的第一次收集记录时间
          const firstCollectionDateMap = new Map<string, Date>();
          if (storeIdsWithoutCachedDate.length > 0) {
            const firstCollectionRecords = await ctx.prisma.collectionRecord.groupBy({
              by: ["storeId"],
              where: { storeId: { in: storeIdsWithoutCachedDate } },
              _min: { loadingTime: true },
            });
            for (const record of firstCollectionRecords) {
              if (record._min.loadingTime) {
                firstCollectionDateMap.set(record.storeId, record._min.loadingTime);
              }
            }
          }

          // 读取 Word 模板
          const templatePath = path.join(process.cwd(), "template", "ISCC.docx");
          const templateContent = fs.readFileSync(templatePath, "binary");

          const currentDate = dayjs().format("YYYY-MM-DD");

          // 收集需要更新签署日期的门店
          const storesToUpdateSignDate: { id: string; signDate: Date }[] = [];

          // 第一步：为每个门店生成 Word 文档
          console.log(`[ISCC Export] Generating ${stores.length} Word documents...`);
          const docxBuffers: Buffer[] = [];

          for (let i = 0; i < stores.length; i++) {
            const store = stores[i];
            try {
              // 发送进度事件
              send({
                type: "generating",
                current: i + 1,
                total: stores.length,
                storeName: store.name,
              });

              // 计算签署日期
              const firstCollectionDate = firstCollectionDateMap.get(store.id) ?? null;
              const { signDate, isNewlyCalculated } = calculateSignDate(
                store.isccSignDate,
                firstCollectionDate,
                store.createdAt
              );

              // 记录需要更新的门店
              if (isNewlyCalculated) {
                storesToUpdateSignDate.push({ id: store.id, signDate });
              }

              // 获取或创建缓存的签名（使用数据库缓存）
              const signatureName = store.legalPerson || store.name;
              const signatureDataURL = await getOrCreateCachedSignature(
                ctx.prisma,
                store.id,
                store.signatureFileId,
                signatureName
              );

              const docxBuf = await generateIsccDocument(
                store,
                collectionPoint,
                templateContent,
                signatureDataURL,
                signDate
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

          // 批量更新新计算的签署日期到数据库
          if (storesToUpdateSignDate.length > 0) {
            console.log(`[ISCC Export] Updating ${storesToUpdateSignDate.length} store sign dates...`);
            await Promise.all(
              storesToUpdateSignDate.map((item) =>
                ctx.prisma.store.update({
                  where: { id: item.id },
                  data: { isccSignDate: item.signDate },
                })
              )
            );
          }

          if (docxBuffers.length === 0) {
            send({ type: "error", message: "Failed to generate any documents" });
            controller.close();
            return;
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

            // 发送合并进度
            send({
              type: "merging",
              batch: batchIndex + 1,
              totalBatches,
            });

            console.log(
              `[ISCC Export] Processing batch ${batchIndex + 1}/${totalBatches} (${
                batchDocx.length
              } docs)...`
            );

            try {
              // 合并这一批的 Word 文档
              const mergedDocx = await mergeDocxFiles(batchDocx);

              // 发送转换进度
              send({
                type: "converting",
                batch: batchIndex + 1,
                totalBatches,
              });

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
            send({ type: "error", message: "Failed to generate any PDF" });
            controller.close();
            return;
          }

          // 准备最终文件
          let finalFileName: string;
          let finalFileType: string;
          let finalBuffer: Buffer;

          if (mergedPdfs.length === 1) {
            // 单个 PDF 文件
            finalFileName = mergedPdfs[0].name;
            finalFileType = "application/pdf";
            finalBuffer = mergedPdfs[0].buffer;
          } else {
            // 多个 PDF，打包成 ZIP
            const zip = new JSZip();
            for (const { name, buffer } of mergedPdfs) {
              zip.file(name, buffer);
            }

            finalBuffer = await zip.generateAsync({
              type: "nodebuffer",
              compression: "DEFLATE",
              compressionOptions: { level: 9 },
            });

            finalFileName = `ISCC_${collectionPoint.name}_${currentDate}.zip`;
            finalFileType = "application/zip";
          }

          // 发送完成事件，包含 base64 编码的文件数据
          send({
            type: "complete",
            fileName: finalFileName,
            fileType: finalFileType,
            data: finalBuffer.toString("base64"),
          });

          controller.close();
        } catch (error) {
          console.error("Export ISCC SSE error:", error);
          controller.enqueue(
            encoder.encode(
              formatSSE({
                type: "error",
                message: error instanceof Error ? error.message : "Internal server error",
              })
            )
          );
          controller.close();
        }
      },
    });

    // 返回 SSE 流响应（需要类型断言因为 SSE 需要原始 Response）
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    }) as unknown as NextResponse;
  });
}
