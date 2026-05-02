-- CreateEnum
CREATE TYPE "SiteConditionKind" AS ENUM ('ok', 'crowded', 'very_crowded', 'closed', 'blocked');

-- AlterTable
ALTER TABLE "SafetyStatus"
  ADD COLUMN "lastKnownLat" DOUBLE PRECISION,
  ADD COLUMN "lastKnownLon" DOUBLE PRECISION,
  ADD COLUMN "locationAccuracyM" DOUBLE PRECISION,
  ADD COLUMN "message" TEXT,
  ADD COLUMN "messagePublic" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "expiresAt" TIMESTAMP(3) NOT NULL DEFAULT (now() + interval '72 hours');

-- AlterTable
ALTER TABLE "SiteStatusReport"
  ADD COLUMN "conditionKind" "SiteConditionKind" NOT NULL DEFAULT 'ok',
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "expiresAt" TIMESTAMP(3) NOT NULL DEFAULT (now() + interval '7 days');

-- CreateIndex
CREATE UNIQUE INDEX "SiteStatusReport_siteId_deviceHash_key" ON "SiteStatusReport"("siteId", "deviceHash");
