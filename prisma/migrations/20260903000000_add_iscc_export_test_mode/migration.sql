-- AlterTable
ALTER TABLE "iscc_export_jobs" ADD COLUMN "testMode" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "iscc_export_jobs" ALTER COLUMN "language" SET DEFAULT 'en';
