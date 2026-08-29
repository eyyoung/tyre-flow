import { ZipArchive } from "archiver";
import dayjs from "dayjs";
import Docxtemplater from "docxtemplater";
import * as fs from "fs";
import { createWriteStream } from "fs";
import { mkdir, rm, stat, writeFile } from "fs/promises";
import sizeOf from "image-size";
import * as path from "path";
import PizZip from "pizzip";
import prisma from "@/lib/db";
import { convertDocxToPdf } from "@/lib/docx-to-pdf";
import { calculateSignDate } from "@/lib/iscc-utils";
import { getTranslatedValue, type TranslationCache } from "@/lib/translations";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ImageModule = require("docxtemplater-image-module-free");

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const SIGNATURE_SERVICE_URL =
  process.env.SIGNATURE_SERVICE_URL || "http://localhost:3333/generate";
const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 100;
const EXPORT_RETENTION_DAYS = 7;

type StoreForExport = {
  id: string;
  code: string;
  name: string;
  nameTranslations: TranslationCache | null;
  legalPerson: string | null;
  legalPersonTranslations: TranslationCache | null;
  address: string;
  addressTranslations: TranslationCache | null;
  province: string | null;
  city: string | null;
  district: string | null;
  isccSignDate: Date | null;
  signatureFileId: string | null;
  createdAt: Date;
};

type CollectionPointForExport = {
  name: string;
  nameTranslations: TranslationCache | null;
  companyName: string | null;
  companyNameTranslations: TranslationCache | null;
  city: string | null;
  cityTranslations: TranslationCache | null;
  province: string | null;
  postcode: string | null;
};

function getBatchSize(): number {
  const configured = Number(process.env.ISCC_EXPORT_BATCH_SIZE);
  if (!Number.isFinite(configured)) return DEFAULT_BATCH_SIZE;
  return Math.max(10, Math.min(MAX_BATCH_SIZE, Math.floor(configured)));
}

export function getIsccExportRoot(): string {
  return path.resolve(
    process.env.ISCC_EXPORT_DIR || path.join(process.cwd(), "data", "iscc-exports")
  );
}

export function resolveIsccExportPath(relativePath: string): string {
  const root = getIsccExportRoot();
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid export file path");
  }
  return resolved;
}

function sanitizeFileName(value: string): string {
  return value.replace(/[/\\?%*:|"<>]/g, "_").replace(/\s+/g, "_");
}

function base64DataURLToArrayBuffer(dataURL: string): ArrayBuffer | false {
  const base64Regex = /^data:image\/(png|jpg|jpeg|svg|svg\+xml);base64,/;
  if (!base64Regex.test(dataURL)) return false;

  const base64Data = dataURL.replace(base64Regex, "");
  return Uint8Array.from(Buffer.from(base64Data, "base64")).buffer;
}

async function generateSignature(name: string): Promise<string | null> {
  try {
    const response = await fetch(SIGNATURE_SERVICE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, stroke_scale: Math.random() * 0.1 + 0.9 }),
    });

    if (!response.ok) {
      console.error(
        `[ISCC Worker] Signature service error: ${response.status} ${response.statusText}`
      );
      return null;
    }

    const data = (await response.json()) as { image?: string };
    if (!data.image) return null;

    const base64Data = data.image.includes(",")
      ? data.image.split(",")[1]
      : data.image;
    return `data:image/png;base64,${base64Data}`;
  } catch (error) {
    console.error("[ISCC Worker] Failed to generate signature:", error);
    return null;
  }
}

async function getOrCreateCachedSignature(
  prismaClient: typeof prisma,
  storeId: string,
  signatureFileId: string | null,
  signatureName: string
): Promise<string | null> {
  if (signatureFileId) {
    const signatureFile = await prismaClient.signatureFile.findUnique({
      where: { id: signatureFileId },
    });
    if (signatureFile) {
      return `data:${signatureFile.mimeType};base64,${Buffer.from(
        signatureFile.data
      ).toString("base64")}`;
    }
  }

  const signatureDataURL = await generateSignature(signatureName);
  if (!signatureDataURL) return null;

  const base64Match = signatureDataURL.match(/^data:([^;]+);base64,(.+)$/);
  if (!base64Match) return signatureDataURL;

  try {
    const [, mimeType, base64Data] = base64Match;
    await prismaClient.$transaction(async (tx) => {
      const signatureFile = await tx.signatureFile.create({
        data: {
          data: Buffer.from(base64Data, "base64"),
          mimeType,
        },
      });
      await tx.store.update({
        where: { id: storeId },
        data: { signatureFileId: signatureFile.id },
      });
    });
  } catch (error) {
    console.error(`[ISCC Worker] Failed to cache signature for ${storeId}:`, error);
  }

  return signatureDataURL;
}

function extractBodyContent(documentXml: string): string {
  const bodyMatch = documentXml.match(/<w:body[^>]*>([\s\S]*)<\/w:body>/);
  if (!bodyMatch) return "";
  return bodyMatch[1].replace(/<w:sectPr[\s\S]*?<\/w:sectPr>\s*$/, "");
}

function extractSectPr(documentXml: string): string {
  return documentXml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/)?.[0] || "";
}

function createPageBreak(): string {
  return `<w:p xmlns:w="${WORD_NS}"><w:r><w:br w:type="page"/></w:r></w:p>`;
}

function mergeDocxFiles(docxBuffers: Buffer[]): Buffer {
  if (docxBuffers.length === 0) throw new Error("No documents to merge");
  if (docxBuffers.length === 1) return docxBuffers[0];

  const baseZip = new PizZip(docxBuffers[0]);
  const baseDocXml = baseZip.file("word/document.xml")?.asText();
  if (!baseDocXml) throw new Error("Invalid base document");

  const allBodyContents = [extractBodyContent(baseDocXml)];
  const baseSectPr = extractSectPr(baseDocXml);
  let imageCounter =
    Object.keys(baseZip.files).filter((file) => file.startsWith("word/media/"))
      .length + 1;
  let baseRelsXml =
    baseZip.file("word/_rels/document.xml.rels")?.asText() || "";

  for (let i = 1; i < docxBuffers.length; i++) {
    const docZip = new PizZip(docxBuffers[i]);
    const docXml = docZip.file("word/document.xml")?.asText();
    if (!docXml) continue;

    let bodyContent = extractBodyContent(docXml);
    const docRelsXml =
      docZip.file("word/_rels/document.xml.rels")?.asText() || "";
    const mediaFiles = Object.keys(docZip.files).filter((file) =>
      file.startsWith("word/media/")
    );

    for (const mediaPath of mediaFiles) {
      const oldFileName = mediaPath.split("/").pop() || "";
      const extension = oldFileName.split(".").pop() || "png";
      const newFileName = `image${imageCounter}.${extension}`;
      const mediaContent = docZip.file(mediaPath)?.asUint8Array();
      if (mediaContent) {
        baseZip.file(`word/media/${newFileName}`, mediaContent);
      }

      const escapedFileName = oldFileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const relationshipPatterns = [
        new RegExp(
          `<Relationship[^>]*Target="media/${escapedFileName}"[^>]*Id="([^"]+)"`,
          "i"
        ),
        new RegExp(
          `<Relationship[^>]*Id="([^"]+)"[^>]*Target="media/${escapedFileName}"`,
          "i"
        ),
      ];
      const oldRelId = relationshipPatterns
        .map((pattern) => docRelsXml.match(pattern)?.[1])
        .find(Boolean);

      if (oldRelId) {
        const newRelId = `rId${1000 + imageCounter}`;
        bodyContent = bodyContent.replace(
          new RegExp(`r:embed="${oldRelId}"`, "g"),
          `r:embed="${newRelId}"`
        );
        const newRel = `<Relationship Id="${newRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${newFileName}"/>`;
        baseRelsXml = baseRelsXml.replace(
          "</Relationships>",
          `${newRel}</Relationships>`
        );
      }
      imageCounter++;
    }

    if (bodyContent) allBodyContents.push(bodyContent);
  }

  const xmlDeclaration =
    baseDocXml.match(/<\?xml[^?]*\?>/)?.[0] ||
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const documentStart =
    baseDocXml.match(/<w:document[^>]*>/)?.[0] || "<w:document>";
  const mergedDocXml = `${xmlDeclaration}
${documentStart}
<w:body>${allBodyContents.join(createPageBreak())}${baseSectPr}</w:body>
</w:document>`;

  baseZip.file("word/document.xml", mergedDocXml);
  baseZip.file("word/_rels/document.xml.rels", baseRelsXml);
  return baseZip.generate({
    type: "nodebuffer",
    compression: "DEFLATE",
  }) as Buffer;
}

async function generateIsccDocument(
  store: StoreForExport,
  collectionPoint: CollectionPointForExport,
  templateContent: string,
  signatureDataURL: string | null,
  signDate: Date,
  lang: string
): Promise<Buffer> {
  const zipDoc = new PizZip(templateContent);
  const modules: unknown[] = [];

  if (signatureDataURL) {
    modules.push(
      new ImageModule({
        centered: false,
        fileType: "docx",
        getImage: (tagValue: string) => {
          const result = base64DataURLToArrayBuffer(tagValue);
          if (result === false) throw new Error("Invalid image data URL");
          return result;
        },
        getSize: (img: ArrayBuffer): [number, number] => {
          const dimensions = sizeOf(Buffer.from(img));
          const width = dimensions.width || 150;
          const height = dimensions.height || 50;
          return [(40 * width) / height, 40];
        },
      })
    );
  }

  const doc = new Docxtemplater(zipDoc, {
    paragraphLoop: true,
    linebreaks: true,
    // The image module has no compatible TypeScript definition.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    modules: modules as any[],
  });

  const translatedCity = collectionPoint.city
    ? getTranslatedValue(
        collectionPoint.city,
        collectionPoint.cityTranslations,
        lang
      )
    : null;
  const translatedCollectionPointName = getTranslatedValue(
    collectionPoint.name,
    collectionPoint.nameTranslations,
    lang
  );
  const translatedCompanyName = collectionPoint.companyName
    ? getTranslatedValue(
        collectionPoint.companyName,
        collectionPoint.companyNameTranslations,
        lang
      )
    : null;

  const renderData: Record<string, unknown> = {
    storeName: getTranslatedValue(store.name, store.nameTranslations, lang),
    legalPerson: store.legalPerson
      ? getTranslatedValue(
          store.legalPerson,
          store.legalPersonTranslations,
          lang
        )
      : "-",
    address: getTranslatedValue(store.address, store.addressTranslations, lang),
    postcodeCity:
      [collectionPoint.postcode, translatedCity].filter(Boolean).join(", ") ||
      "-",
    country: "China",
    collectionPoint:
      translatedCompanyName || translatedCollectionPointName,
    placeDate: `${translatedCity || collectionPoint.province || "China"}, ${dayjs(
      signDate
    ).format("YYYY/MM/DD")}`,
  };
  if (signatureDataURL) renderData.signature = signatureDataURL;

  doc.render(renderData);
  return doc.getZip().generate({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
}

export async function generateSingleIsccPdf(
  storeId: string,
  lang: string
): Promise<{ buffer: Buffer; fileName: string } | null> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    include: {
      collectionPoint: {
        select: {
          name: true,
          nameTranslations: true,
          companyName: true,
          companyNameTranslations: true,
          city: true,
          cityTranslations: true,
          province: true,
          postcode: true,
        },
      },
    },
  });
  if (!store) return null;

  let firstCollectionDate: Date | null = null;
  if (!store.isccSignDate) {
    const firstCollectionRecord = await prisma.collectionRecord.findFirst({
      where: { storeId },
      orderBy: { loadingTime: "asc" },
      select: { loadingTime: true },
    });
    firstCollectionDate = firstCollectionRecord?.loadingTime || null;
  }

  const { signDate, isNewlyCalculated } = calculateSignDate(
    store.isccSignDate,
    firstCollectionDate,
    store.createdAt
  );
  if (isNewlyCalculated) {
    await prisma.store.update({
      where: { id: storeId },
      data: { isccSignDate: signDate },
    });
  }

  const signatureDataURL = await getOrCreateCachedSignature(
    prisma,
    store.id,
    store.signatureFileId,
    store.legalPerson || store.name
  );
  const templateContent = fs.readFileSync(
    path.join(process.cwd(), "template", "ISCC.docx"),
    "binary"
  );
  const docxBuffer = await generateIsccDocument(
    store as StoreForExport,
    store.collectionPoint as CollectionPointForExport,
    templateContent,
    signatureDataURL,
    signDate,
    lang
  );
  const pdfBuffer = await convertDocxToPdf(docxBuffer);
  const translatedStoreName = getTranslatedValue(
    store.name,
    store.nameTranslations as TranslationCache | null,
    lang
  );

  return {
    buffer: pdfBuffer,
    fileName: `ISCC_${sanitizeFileName(translatedStoreName)}.pdf`,
  };
}

async function createZipFromFiles(
  outputPath: string,
  files: Array<{ path: string; name: string }>
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(outputPath);
    const zip = new ZipArchive({ zlib: { level: 6 } });

    output.on("close", resolve);
    output.on("error", reject);
    zip.on("error", reject);
    zip.pipe(output);

    for (const file of files) {
      zip.file(file.path, { name: file.name });
    }
    void zip.finalize();
  });
}

async function updateProgress(
  jobId: string,
  values: {
    phase: string;
    progress: number;
    processed: number;
    total: number;
  }
): Promise<void> {
  await prisma.isccExportJob.update({
    where: { id: jobId },
    data: values,
  });
}

export async function processIsccExportJob(jobId: string): Promise<void> {
  const job = await prisma.isccExportJob.findUnique({
    where: { id: jobId },
    include: {
      collectionPoint: {
        select: {
          name: true,
          nameTranslations: true,
          companyName: true,
          companyNameTranslations: true,
          city: true,
          cityTranslations: true,
          province: true,
          postcode: true,
        },
      },
    },
  });
  if (!job) throw new Error(`ISCC export job ${jobId} not found`);

  const jobDir = resolveIsccExportPath(job.id);
  try {
    await rm(jobDir, { recursive: true, force: true });
    await mkdir(jobDir, { recursive: true });

    const stores = (await prisma.store.findMany({
      where: {
        collectionPointId: job.collectionPointId,
        status: "ACTIVE",
        isVirtual: false,
      },
      select: {
        id: true,
        code: true,
        name: true,
        nameTranslations: true,
        legalPerson: true,
        legalPersonTranslations: true,
        address: true,
        addressTranslations: true,
        province: true,
        city: true,
        district: true,
        isccSignDate: true,
        signatureFileId: true,
        createdAt: true,
      },
      orderBy: { code: "asc" },
    })) as StoreForExport[];

    if (stores.length === 0) {
      throw new Error("No active non-virtual stores found");
    }

    const total = stores.length;
    await updateProgress(jobId, {
      phase: "generating",
      progress: 0,
      processed: 0,
      total,
    });

    const storesWithoutCachedDate = stores.filter((store) => !store.isccSignDate);
    const firstCollectionDateMap = new Map<string, Date>();
    if (storesWithoutCachedDate.length > 0) {
      const firstCollectionRecords = await prisma.collectionRecord.groupBy({
        by: ["storeId"],
        where: { storeId: { in: storesWithoutCachedDate.map((store) => store.id) } },
        _min: { loadingTime: true },
      });
      for (const record of firstCollectionRecords) {
        if (record._min.loadingTime) {
          firstCollectionDateMap.set(record.storeId, record._min.loadingTime);
        }
      }
    }

    const templateContent = fs.readFileSync(
      path.join(process.cwd(), "template", "ISCC.docx"),
      "binary"
    );
    const batchSize = getBatchSize();
    const totalBatches = Math.ceil(total / batchSize);
    const pdfFiles: Array<{ path: string; name: string }> = [];
    const currentDate = dayjs().format("YYYY-MM-DD");
    const collectionPointName = sanitizeFileName(
      getTranslatedValue(
        job.collectionPoint.name,
        job.collectionPoint.nameTranslations as TranslationCache | null,
        job.language
      )
    );

    console.log(
      `[ISCC Worker] Job ${jobId}: ${total} stores, ${totalBatches} batches of at most ${batchSize}`
    );

    let processed = 0;
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const batchStores = stores.slice(
        batchIndex * batchSize,
        Math.min((batchIndex + 1) * batchSize, total)
      );
      const docxBuffers: Buffer[] = [];

      for (let storeIndex = 0; storeIndex < batchStores.length; storeIndex++) {
        const store = batchStores[storeIndex];
        const { signDate, isNewlyCalculated } = calculateSignDate(
          store.isccSignDate,
          firstCollectionDateMap.get(store.id) || null,
          store.createdAt
        );
        if (isNewlyCalculated) {
          await prisma.store.update({
            where: { id: store.id },
            data: { isccSignDate: signDate },
          });
        }

        const signatureDataURL = await getOrCreateCachedSignature(
          prisma,
          store.id,
          store.signatureFileId,
          store.legalPerson || store.name
        );
        docxBuffers.push(
          await generateIsccDocument(
            store,
            job.collectionPoint as CollectionPointForExport,
            templateContent,
            signatureDataURL,
            signDate,
            job.language
          )
        );
        processed++;

        if (processed % 10 === 0 || processed === total) {
          await updateProgress(jobId, {
            phase: "generating",
            progress: Math.min(
              94,
              Math.floor(
                ((batchIndex +
                  ((storeIndex + 1) / batchStores.length) * 0.75) /
                  totalBatches) *
                  95
              )
            ),
            processed,
            total,
          });
        }
      }

      await updateProgress(jobId, {
        phase: "merging",
        progress: Math.min(
          94,
          Math.floor(((batchIndex + 0.8) / totalBatches) * 95)
        ),
        processed,
        total,
      });
      const mergedDocx = mergeDocxFiles(docxBuffers);

      await updateProgress(jobId, {
        phase: "converting",
        progress: Math.min(
          95,
          Math.floor(((batchIndex + 0.9) / totalBatches) * 95)
        ),
        processed,
        total,
      });
      const pdfBuffer = await convertDocxToPdf(mergedDocx);
      const pdfName = `ISCC_${collectionPointName}_${currentDate}_${String(
        batchIndex + 1
      ).padStart(3, "0")}.pdf`;
      const pdfPath = path.join(jobDir, pdfName);
      await writeFile(pdfPath, pdfBuffer);
      pdfFiles.push({ path: pdfPath, name: pdfName });

      docxBuffers.length = 0;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    await updateProgress(jobId, {
      phase: "packaging",
      progress: 97,
      processed,
      total,
    });

    const finalFileName = `ISCC_${collectionPointName}_${currentDate}.zip`;
    const finalPath = path.join(jobDir, finalFileName);
    await createZipFromFiles(finalPath, pdfFiles);

    for (const pdfFile of pdfFiles) {
      await rm(pdfFile.path, { force: true });
    }

    const fileInfo = await stat(finalPath);
    await prisma.isccExportJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        phase: "completed",
        progress: 100,
        processed: total,
        total,
        fileName: finalFileName,
        filePath: path.posix.join(job.id, finalFileName),
        fileType: "application/zip",
        fileSize: fileInfo.size,
        errorMessage: null,
        completedAt: new Date(),
        expiresAt: dayjs().add(EXPORT_RETENTION_DAYS, "day").toDate(),
      },
    });
    console.log(`[ISCC Worker] Job ${jobId} completed`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ISCC Worker] Job ${jobId} failed:`, error);
    await rm(jobDir, { recursive: true, force: true }).catch((cleanupError) => {
      console.error(`[ISCC Worker] Failed to clean job ${jobId} files:`, cleanupError);
    });
    await prisma.isccExportJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        phase: "failed",
        errorMessage: message.slice(0, 2000),
        completedAt: new Date(),
      },
    });
    throw error;
  }
}

export async function expireOldIsccExports(): Promise<void> {
  const expiredJobs = await prisma.isccExportJob.findMany({
    where: {
      status: "COMPLETED",
      expiresAt: { lt: new Date() },
    },
    select: { id: true },
  });

  for (const job of expiredJobs) {
    await rm(resolveIsccExportPath(job.id), { recursive: true, force: true });
    await prisma.isccExportJob.update({
      where: { id: job.id },
      data: {
        status: "EXPIRED",
        phase: "expired",
        fileName: null,
        filePath: null,
        fileType: null,
        fileSize: null,
      },
    });
  }
}
