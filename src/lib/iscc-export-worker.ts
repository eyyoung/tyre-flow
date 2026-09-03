import { rm } from "fs/promises";
import prisma from "@/lib/db";
import {
  expireOldIsccExports,
  processIsccExportJob,
  resolveIsccExportPath,
} from "@/lib/iscc-export-generator";

const POLL_INTERVAL_MS = 5_000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

let workerInterval: NodeJS.Timeout | null = null;
let isProcessing = false;
let lastCleanupAt = 0;

async function recoverStaleJobs(): Promise<void> {
  // 生产环境只有一个 worker 进程：它在启动，说明上一个进程里的任务都已经死了，
  // 所有 PROCESSING 都是上次异常退出留下的。用户已请求停止的直接标记为已停止，其余重新排队。
  const cancelling = await prisma.isccExportJob.findMany({
    where: { status: "PROCESSING", cancelRequestedAt: { not: null } },
    select: { id: true },
  });
  for (const { id } of cancelling) {
    await rm(resolveIsccExportPath(id), { recursive: true, force: true }).catch(() => {});
    await prisma.isccExportJob.updateMany({
      where: { id, status: "PROCESSING" },
      data: {
        status: "CANCELLED",
        phase: "cancelled",
        errorMessage: null,
        completedAt: new Date(),
      },
    });
  }
  if (cancelling.length > 0) {
    console.log(`[ISCC Worker] Marked ${cancelling.length} stale job(s) as cancelled`);
  }

  const result = await prisma.isccExportJob.updateMany({
    where: { status: "PROCESSING" },
    data: {
      status: "PENDING",
      phase: "queued",
      errorMessage: null,
    },
  });
  if (result.count > 0) {
    console.log(`[ISCC Worker] Requeued ${result.count} stale job(s)`);
  }
}

async function claimNextJob(): Promise<string | null> {
  const nextJob = await prisma.isccExportJob.findFirst({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!nextJob) return null;

  const claim = await prisma.isccExportJob.updateMany({
    where: { id: nextJob.id, status: "PENDING" },
    data: {
      status: "PROCESSING",
      phase: "starting",
      progress: 0,
      processed: 0,
      startedAt: new Date(),
      completedAt: null,
      errorMessage: null,
    },
  });
  return claim.count === 1 ? nextJob.id : null;
}

async function runCleanupIfDue(): Promise<void> {
  if (Date.now() - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = Date.now();
  await expireOldIsccExports();
}

async function tick(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;

  try {
    await runCleanupIfDue();
    const jobId = await claimNextJob();
    if (jobId) {
      await processIsccExportJob(jobId);
    }
  } catch (error) {
    // Missing tables during a rolling deployment are retried on the next poll.
    console.error("[ISCC Worker] Poll failed:", error);
  } finally {
    isProcessing = false;
  }
}

export function startIsccExportWorker(): void {
  if (workerInterval) {
    console.log("[ISCC Worker] Already running");
    return;
  }

  console.log(
    `[ISCC Worker] Starting (poll interval: ${POLL_INTERVAL_MS / 1000}s)`
  );
  void recoverStaleJobs().catch((error) => {
    console.error("[ISCC Worker] Stale-job recovery failed:", error);
  });
  void tick();
  workerInterval = setInterval(() => void tick(), POLL_INTERVAL_MS);
}

export function stopIsccExportWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
}
