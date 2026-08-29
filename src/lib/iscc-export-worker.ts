import prisma from "@/lib/db";
import {
  expireOldIsccExports,
  processIsccExportJob,
} from "@/lib/iscc-export-generator";

const POLL_INTERVAL_MS = 5_000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

let workerInterval: NodeJS.Timeout | null = null;
let isProcessing = false;
let lastCleanupAt = 0;

async function recoverStaleJobs(): Promise<void> {
  const result = await prisma.isccExportJob.updateMany({
    // Production runs a single dedicated worker container. If it is starting,
    // no prior in-process job can still be alive, so all unfinished claims are safe to retry.
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
