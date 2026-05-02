-- CreateEnum
CREATE TYPE "AccessibilityLevel" AS ENUM ('accessible', 'blocked', 'unknown');

-- CreateEnum
CREATE TYPE "CongestionLevel" AS ENUM ('low', 'normal', 'high');

-- CreateEnum
CREATE TYPE "HazardType" AS ENUM ('earthquake', 'tsunami', 'flood', 'inland_flood', 'typhoon', 'landslide', 'fire', 'volcano', 'storm_surge');

-- CreateEnum
CREATE TYPE "SafetyState" AS ENUM ('safe', 'minor_injury', 'serious_injury', 'isolated', 'evacuating', 'evacuated');

-- CreateEnum
CREATE TYPE "SiteKind" AS ENUM ('shelter', 'space', 'other');

-- CreateTable
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "deviceHash" TEXT NOT NULL,
    "transferCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvacSite" (
    "id" UUID NOT NULL,
    "kind" "SiteKind" NOT NULL,
    "sourceId" TEXT,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "municipalityCode" TEXT,
    "capacity" INTEGER,
    "isDesignated" BOOLEAN NOT NULL DEFAULT true,
    "sourceName" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "EvacSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvacSiteHazardCapability" (
    "id" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "hazardType" "HazardType" NOT NULL,
    "isSupported" BOOLEAN NOT NULL DEFAULT false,
    "remark" TEXT,

    CONSTRAINT "EvacSiteHazardCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HazardAlertSnapshot" (
    "id" UUID NOT NULL,
    "regionId" UUID NOT NULL,
    "hazardType" "HazardType" NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HazardAlertSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyStatus" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "status" "SafetyState" NOT NULL,
    "currentSiteId" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafetyStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteStatusReport" (
    "id" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "deviceHash" TEXT NOT NULL,
    "deviceId" UUID,
    "congestionLevel" "CongestionLevel" NOT NULL,
    "accessibility" "AccessibilityLevel" NOT NULL,
    "comment" TEXT,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteStatusReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchRegion" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radiusKm" DOUBLE PRECISION NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WatchRegion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchRegionHazard" (
    "id" UUID NOT NULL,
    "regionId" UUID NOT NULL,
    "hazardType" "HazardType" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "WatchRegionHazard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Device_deviceHash_key" ON "Device"("deviceHash");

-- CreateIndex
CREATE UNIQUE INDEX "Device_transferCode_key" ON "Device"("transferCode");

-- CreateIndex
CREATE UNIQUE INDEX "EvacSite_sourceId_key" ON "EvacSite"("sourceId");

-- CreateIndex
CREATE INDEX "EvacSite_latitude_longitude_idx" ON "EvacSite"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "EvacSite_municipalityCode_idx" ON "EvacSite"("municipalityCode");

-- CreateIndex
CREATE INDEX "EvacSiteHazardCapability_hazardType_idx" ON "EvacSiteHazardCapability"("hazardType");

-- CreateIndex
CREATE UNIQUE INDEX "EvacSiteHazardCapability_siteId_hazardType_key" ON "EvacSiteHazardCapability"("siteId", "hazardType");

-- CreateIndex
CREATE INDEX "HazardAlertSnapshot_regionId_hazardType_checkedAt_idx" ON "HazardAlertSnapshot"("regionId", "hazardType", "checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyStatus_deviceId_key" ON "SafetyStatus"("deviceId");

-- CreateIndex
CREATE INDEX "SiteStatusReport_deviceHash_reportedAt_idx" ON "SiteStatusReport"("deviceHash", "reportedAt");

-- CreateIndex
CREATE INDEX "SiteStatusReport_deviceId_idx" ON "SiteStatusReport"("deviceId");

-- CreateIndex
CREATE INDEX "SiteStatusReport_siteId_reportedAt_idx" ON "SiteStatusReport"("siteId", "reportedAt");

-- CreateIndex
CREATE INDEX "WatchRegion_deviceId_idx" ON "WatchRegion"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "WatchRegionHazard_regionId_hazardType_key" ON "WatchRegionHazard"("regionId", "hazardType");

-- AddForeignKey
ALTER TABLE "EvacSiteHazardCapability" ADD CONSTRAINT "EvacSiteHazardCapability_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "EvacSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HazardAlertSnapshot" ADD CONSTRAINT "HazardAlertSnapshot_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "WatchRegion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyStatus" ADD CONSTRAINT "SafetyStatus_currentSiteId_fkey" FOREIGN KEY ("currentSiteId") REFERENCES "EvacSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyStatus" ADD CONSTRAINT "SafetyStatus_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteStatusReport" ADD CONSTRAINT "SiteStatusReport_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteStatusReport" ADD CONSTRAINT "SiteStatusReport_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "EvacSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchRegion" ADD CONSTRAINT "WatchRegion_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchRegionHazard" ADD CONSTRAINT "WatchRegionHazard_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "WatchRegion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

