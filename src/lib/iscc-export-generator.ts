import { ZipArchive } from "archiver";
import dayjs from "dayjs";
import * as fs from "fs";
import { createWriteStream } from "fs";
import { mkdir, rm, stat, writeFile } from "fs/promises";
import * as path from "path";
import prisma from "@/lib/db";
import { fillIsccForm, mergePdfDocuments, type IsccFormData } from "@/lib/iscc-pdf-form";
import {
  DEFAULT_ISCC_TEMPLATE,
  ISCC_EXPORT_LANGUAGE,
  ISCC_TEST_EXPORT_STORE_LIMIT,
  getIsccTemplate,
  isIsccTemplateKey,
  type IsccTemplateKey,
} from "@/lib/iscc-templates";
import { calculateSignDate } from "@/lib/iscc-utils";
import { getTranslatedValue, type TranslationCache } from "@/lib/translations";

const SIGNATURE_SERVICE_URL =
  process.env.SIGNATURE_SERVICE_URL || "http://localhost:3333/generate";
const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 100;
const EXPORT_RETENTION_DAYS = 7;
const NOT_AVAILABLE = "-";
// 新版模板（ISCC PLUS v2.0 / ISCC EU v2.3）新增字段的默认值
const SIGNATORY_POSITION = "Legal Representative";
// 「The delivered material consists of the following waste or residues」的固定申报内容
const DELIVERED_MATERIAL = "Biogenic fraction of end-of-life tires";
// 「产废量不低于 10 t/月（PLUS）/ 5 t/月（EU）」声明固定不勾选：
// 台账显示门店月产废量普遍在 1～3 t，没有门店达到阈值
const MIN_VOLUME_CONFIRMED = false;
// EU 模板「Maximum estimated (sustainable) capacity per year (in mt)」的统一申报值。
// 取 60 t/年（5 t/月阈值）以下的整数，与上面不勾选保持一致；废轮胎整批作为
// 废弃物进入 ISCC 渠道，可持续产能与总产能相同
const MAX_CAPACITY_TONNES_PER_YEAR = 50;
const MAX_SUSTAINABLE_CAPACITY_TONNES_PER_YEAR = MAX_CAPACITY_TONNES_PER_YEAR;

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
  contactPhone: string | null;
  latitude: number | null;
  longitude: number | null;
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

function resolveTemplateKey(value: string | null | undefined): IsccTemplateKey {
  return isIsccTemplateKey(value) ? value : DEFAULT_ISCC_TEMPLATE;
}

function loadIsccTemplate(templateKey: IsccTemplateKey): Uint8Array {
  const { file } = getIsccTemplate(templateKey);
  return fs.readFileSync(path.join(process.cwd(), "template", file));
}

function formatGeoCoordinates(
  latitude: number | null,
  longitude: number | null
): string {
  if (latitude == null || longitude == null) return NOT_AVAILABLE;
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

function sanitizeFileName(value: string): string {
  return value.replace(/[/\\?%*:|"<>]/g, "_").replace(/\s+/g, "_");
}

/** 签名 data URL（PNG / JPEG）转字节；其他格式无法嵌入 PDF，返回 null */
function signatureDataURLToBytes(dataURL: string | null): Uint8Array | null {
  if (!dataURL) return null;
  const match = dataURL.match(/^data:image\/(png|jpg|jpeg);base64,(.+)$/);
  if (!match) return null;
  return new Uint8Array(Buffer.from(match[2], "base64"));
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

async function generateIsccPdf(
  store: StoreForExport,
  collectionPoint: CollectionPointForExport,
  templateKey: IsccTemplateKey,
  templateBytes: Uint8Array,
  signatureDataURL: string | null,
  signDate: Date,
  lang: string
): Promise<Uint8Array> {
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

  const data: IsccFormData = {
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
      NOT_AVAILABLE,
    cityPostcode:
      [translatedCity, collectionPoint.postcode].filter(Boolean).join(", ") ||
      NOT_AVAILABLE,
    country: "China",
    phone: store.contactPhone || NOT_AVAILABLE,
    geoCoordinates: formatGeoCoordinates(store.latitude, store.longitude),
    position: SIGNATORY_POSITION,
    minVolumeCheck: MIN_VOLUME_CONFIRMED,
    maxCapacity: String(MAX_CAPACITY_TONNES_PER_YEAR),
    maxSustainableCapacity: String(MAX_SUSTAINABLE_CAPACITY_TONNES_PER_YEAR),
    collectionPoint: translatedCompanyName || translatedCollectionPointName,
    placeDate: `${translatedCity || collectionPoint.province || "China"}, ${dayjs(
      signDate
    ).format("YYYY/MM/DD")}`,
    deliveredMaterial: DELIVERED_MATERIAL,
  };

  return fillIsccForm(
    templateBytes,
    templateKey,
    data,
    signatureDataURLToBytes(signatureDataURL)
  );
}

export async function generateSingleIsccPdf(
  storeId: string,
  templateKey: IsccTemplateKey = DEFAULT_ISCC_TEMPLATE
): Promise<{ buffer: Buffer; fileName: string } | null> {
  const lang = ISCC_EXPORT_LANGUAGE;
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
  const pdfBytes = await generateIsccPdf(
    store as StoreForExport,
    store.collectionPoint as CollectionPointForExport,
    templateKey,
    loadIsccTemplate(templateKey),
    signatureDataURL,
    signDate,
    lang
  );
  const translatedStoreName = getTranslatedValue(
    store.name,
    store.nameTranslations as TranslationCache | null,
    lang
  );

  return {
    buffer: Buffer.from(pdfBytes),
    fileName: `${getIsccTemplate(templateKey).filePrefix}_${sanitizeFileName(
      translatedStoreName
    )}.pdf`,
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

/** 用户请求停止时由 worker 抛出，用来把「主动停止」和「失败」区分开 */
export class IsccExportCancelledError extends Error {
  constructor(jobId: string) {
    super(`ISCC export job ${jobId} was cancelled`);
    this.name = "IsccExportCancelledError";
  }
}

/** 检查用户是否已请求停止（见 jobs/[id]/cancel 路由）。在两份文档之间调用，所以停止最多再多生成一份 */
async function throwIfCancelRequested(jobId: string): Promise<void> {
  const job = await prisma.isccExportJob.findUnique({
    where: { id: jobId },
    select: { cancelRequestedAt: true },
  });
  if (!job || job.cancelRequestedAt) throw new IsccExportCancelledError(jobId);
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
        contactPhone: true,
        latitude: true,
        longitude: true,
        isccSignDate: true,
        signatureFileId: true,
        createdAt: true,
      },
      orderBy: { code: "asc" },
      // 「仅测试用」任务只处理前 N 家门店
      take: job.testMode ? ISCC_TEST_EXPORT_STORE_LIMIT : undefined,
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

    const templateKey = resolveTemplateKey(job.template);
    const { filePrefix } = getIsccTemplate(templateKey);
    const templateBytes = loadIsccTemplate(templateKey);
    const batchSize = getBatchSize();
    const totalBatches = Math.ceil(total / batchSize);
    const pdfFiles: Array<{ path: string; name: string }> = [];
    const currentDate = dayjs().format("YYYY-MM-DD");
    // 测试导出的文件名加 _TEST 后缀，避免和正式导出混淆
    const fileSuffix = job.testMode ? "_TEST" : "";
    const collectionPointName = sanitizeFileName(
      getTranslatedValue(
        job.collectionPoint.name,
        job.collectionPoint.nameTranslations as TranslationCache | null,
        ISCC_EXPORT_LANGUAGE
      )
    );

    console.log(
      `[ISCC Worker] Job ${jobId}: template ${job.template}${job.testMode ? " (test)" : ""}, ${total} stores, ${totalBatches} batches of at most ${batchSize}`
    );

    let processed = 0;
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const batchStores = stores.slice(
        batchIndex * batchSize,
        Math.min((batchIndex + 1) * batchSize, total)
      );
      const pdfDocuments: Uint8Array[] = [];

      for (let storeIndex = 0; storeIndex < batchStores.length; storeIndex++) {
        await throwIfCancelRequested(jobId);
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
        pdfDocuments.push(
          await generateIsccPdf(
            store,
            job.collectionPoint as CollectionPointForExport,
            templateKey,
            templateBytes,
            signatureDataURL,
            signDate,
            ISCC_EXPORT_LANGUAGE
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

      await throwIfCancelRequested(jobId);
      await updateProgress(jobId, {
        phase: "merging",
        progress: Math.min(
          94,
          Math.floor(((batchIndex + 0.8) / totalBatches) * 95)
        ),
        processed,
        total,
      });
      const pdfBuffer = Buffer.from(await mergePdfDocuments(pdfDocuments));
      const pdfName = `${filePrefix}_${collectionPointName}_${currentDate}${fileSuffix}_${String(
        batchIndex + 1
      ).padStart(3, "0")}.pdf`;
      const pdfPath = path.join(jobDir, pdfName);
      await writeFile(pdfPath, pdfBuffer);
      pdfFiles.push({ path: pdfPath, name: pdfName });

      pdfDocuments.length = 0;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    await throwIfCancelRequested(jobId);
    await updateProgress(jobId, {
      phase: "packaging",
      progress: 97,
      processed,
      total,
    });

    const finalFileName = `${filePrefix}_${collectionPointName}_${currentDate}${fileSuffix}.zip`;
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
    await rm(jobDir, { recursive: true, force: true }).catch((cleanupError) => {
      console.error(`[ISCC Worker] Failed to clean job ${jobId} files:`, cleanupError);
    });
    if (error instanceof IsccExportCancelledError) {
      await prisma.isccExportJob.updateMany({
        where: { id: jobId },
        data: {
          status: "CANCELLED",
          phase: "cancelled",
          errorMessage: null,
          completedAt: new Date(),
        },
      });
      console.log(`[ISCC Worker] Job ${jobId} cancelled by user`);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ISCC Worker] Job ${jobId} failed:`, error);
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
