-- CreateEnum
CREATE TYPE "IsccExportJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "iscc_export_jobs" (
    "id" TEXT NOT NULL,
    "collectionPointId" TEXT NOT NULL,
    "requestedById" TEXT,
    "language" TEXT NOT NULL DEFAULT 'zh',
    "status" "IsccExportJobStatus" NOT NULL DEFAULT 'PENDING',
    "phase" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "fileName" TEXT,
    "filePath" TEXT,
    "fileType" TEXT,
    "fileSize" INTEGER,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "iscc_export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "iscc_export_jobs_status_createdAt_idx" ON "iscc_export_jobs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "iscc_export_jobs_collectionPointId_createdAt_idx" ON "iscc_export_jobs"("collectionPointId", "createdAt");

-- AddForeignKey
ALTER TABLE "iscc_export_jobs" ADD CONSTRAINT "iscc_export_jobs_collectionPointId_fkey" FOREIGN KEY ("collectionPointId") REFERENCES "collection_points"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iscc_export_jobs" ADD CONSTRAINT "iscc_export_jobs_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
