-- AlterEnum
ALTER TYPE "IsccExportJobStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "iscc_export_jobs" ADD COLUMN "cancelRequestedAt" TIMESTAMP(3);
