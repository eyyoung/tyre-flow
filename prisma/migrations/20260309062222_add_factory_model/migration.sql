-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "Status" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "StoreStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('COLLECTION', 'TRANSFER');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "role" "Role" NOT NULL DEFAULT 'ADMIN',
    "status" "Status" NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_points" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameTranslations" JSONB,
    "companyName" TEXT,
    "companyNameTranslations" JSONB,
    "address" TEXT NOT NULL,
    "addressTranslations" JSONB,
    "province" TEXT,
    "city" TEXT,
    "cityTranslations" JSONB,
    "district" TEXT,
    "postcode" TEXT,
    "longitude" DOUBLE PRECISION,
    "latitude" DOUBLE PRECISION,
    "certScope" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "status" "Status" NOT NULL DEFAULT 'ACTIVE',
    "translatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collection_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_collection_points" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "collectionPointId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_collection_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signature_files" (
    "id" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'image/png',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signature_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stores" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameTranslations" JSONB,
    "businessLicense" TEXT,
    "legalPerson" TEXT,
    "legalPersonTranslations" JSONB,
    "address" TEXT NOT NULL,
    "addressTranslations" JSONB,
    "province" TEXT,
    "city" TEXT,
    "district" TEXT,
    "longitude" DOUBLE PRECISION,
    "latitude" DOUBLE PRECISION,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "estimatedTravelMinutes" INTEGER NOT NULL DEFAULT 0,
    "status" "StoreStatus" NOT NULL DEFAULT 'ACTIVE',
    "disabledAt" TIMESTAMP(3),
    "disabledReason" TEXT,
    "isVirtual" BOOLEAN NOT NULL DEFAULT true,
    "collectionPointId" TEXT NOT NULL,
    "signatureFileId" TEXT,
    "isccSignDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL,
    "plateNumber" TEXT NOT NULL,
    "type" "VehicleType" NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "tareWeight" DOUBLE PRECISION NOT NULL,
    "tareWeightVariance" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "maxLoad" DOUBLE PRECISION NOT NULL,
    "driverName" TEXT,
    "driverNameTranslations" JSONB,
    "driverPhone" TEXT,
    "collectionPointId" TEXT NOT NULL,
    "status" "Status" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_configs" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "Status" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "factories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_tasks" (
    "id" TEXT NOT NULL,
    "taskNo" TEXT NOT NULL,
    "year" INTEGER,
    "month" INTEGER,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "targetTonnage" DOUBLE PRECISION NOT NULL,
    "actualTonnage" DOUBLE PRECISION,
    "unloadingTonnage" DOUBLE PRECISION,
    "totalLoss" DOUBLE PRECISION,
    "maxTripsPerVehiclePerDay" INTEGER NOT NULL DEFAULT 2,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "collectionPointId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_tasks" (
    "id" TEXT NOT NULL,
    "taskNo" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "targetTonnage" DOUBLE PRECISION NOT NULL,
    "actualTonnage" DOUBLE PRECISION,
    "unloadingTonnage" DOUBLE PRECISION,
    "totalLoss" DOUBLE PRECISION,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "collectionPointId" TEXT NOT NULL,
    "factoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfer_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_records" (
    "id" TEXT NOT NULL,
    "recordNo" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "collectionDate" TIMESTAMP(3) NOT NULL,
    "loadingTime" TIMESTAMP(3) NOT NULL,
    "unloadingTime" TIMESTAMP(3),
    "tireCount" INTEGER NOT NULL,
    "loadingNetWeight" DOUBLE PRECISION NOT NULL,
    "unloadingNetWeight" DOUBLE PRECISION NOT NULL,
    "loss" DOUBLE PRECISION NOT NULL,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_records" (
    "id" TEXT NOT NULL,
    "recordNo" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "transferDate" TIMESTAMP(3) NOT NULL,
    "destination" TEXT NOT NULL,
    "tireCount" INTEGER NOT NULL,
    "loadingNetWeight" DOUBLE PRECISION NOT NULL,
    "grossWeight" DOUBLE PRECISION NOT NULL,
    "tareWeight" DOUBLE PRECISION NOT NULL,
    "unloadingNetWeight" DOUBLE PRECISION NOT NULL,
    "loss" DOUBLE PRECISION NOT NULL,
    "weighbridgeNo" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfer_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "collection_points_code_key" ON "collection_points"("code");

-- CreateIndex
CREATE UNIQUE INDEX "user_collection_points_userId_collectionPointId_key" ON "user_collection_points"("userId", "collectionPointId");

-- CreateIndex
CREATE UNIQUE INDEX "stores_code_key" ON "stores"("code");

-- CreateIndex
CREATE UNIQUE INDEX "stores_signatureFileId_key" ON "stores"("signatureFileId");

-- CreateIndex
CREATE INDEX "stores_collectionPointId_idx" ON "stores"("collectionPointId");

-- CreateIndex
CREATE INDEX "stores_status_idx" ON "stores"("status");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_plateNumber_key" ON "vehicles"("plateNumber");

-- CreateIndex
CREATE INDEX "vehicles_collectionPointId_idx" ON "vehicles"("collectionPointId");

-- CreateIndex
CREATE INDEX "vehicles_type_idx" ON "vehicles"("type");

-- CreateIndex
CREATE UNIQUE INDEX "system_configs_key_key" ON "system_configs"("key");

-- CreateIndex
CREATE UNIQUE INDEX "factories_name_key" ON "factories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_tasks_taskNo_key" ON "ledger_tasks"("taskNo");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_tasks_collectionPointId_startDate_endDate_key" ON "ledger_tasks"("collectionPointId", "startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_tasks_taskNo_key" ON "transfer_tasks"("taskNo");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_tasks_collectionPointId_startDate_endDate_key" ON "transfer_tasks"("collectionPointId", "startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "collection_records_recordNo_key" ON "collection_records"("recordNo");

-- CreateIndex
CREATE INDEX "collection_records_taskId_idx" ON "collection_records"("taskId");

-- CreateIndex
CREATE INDEX "collection_records_storeId_idx" ON "collection_records"("storeId");

-- CreateIndex
CREATE INDEX "collection_records_collectionDate_idx" ON "collection_records"("collectionDate");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_records_recordNo_key" ON "transfer_records"("recordNo");

-- CreateIndex
CREATE INDEX "transfer_records_taskId_idx" ON "transfer_records"("taskId");

-- CreateIndex
CREATE INDEX "transfer_records_transferDate_idx" ON "transfer_records"("transferDate");

-- AddForeignKey
ALTER TABLE "user_collection_points" ADD CONSTRAINT "user_collection_points_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_collection_points" ADD CONSTRAINT "user_collection_points_collectionPointId_fkey" FOREIGN KEY ("collectionPointId") REFERENCES "collection_points"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_collectionPointId_fkey" FOREIGN KEY ("collectionPointId") REFERENCES "collection_points"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_signatureFileId_fkey" FOREIGN KEY ("signatureFileId") REFERENCES "signature_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_collectionPointId_fkey" FOREIGN KEY ("collectionPointId") REFERENCES "collection_points"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_tasks" ADD CONSTRAINT "ledger_tasks_collectionPointId_fkey" FOREIGN KEY ("collectionPointId") REFERENCES "collection_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_tasks" ADD CONSTRAINT "transfer_tasks_collectionPointId_fkey" FOREIGN KEY ("collectionPointId") REFERENCES "collection_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_tasks" ADD CONSTRAINT "transfer_tasks_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_records" ADD CONSTRAINT "collection_records_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ledger_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_records" ADD CONSTRAINT "collection_records_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_records" ADD CONSTRAINT "collection_records_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_records" ADD CONSTRAINT "transfer_records_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "transfer_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_records" ADD CONSTRAINT "transfer_records_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
