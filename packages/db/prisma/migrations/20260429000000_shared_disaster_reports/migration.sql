DO $$
BEGIN
  CREATE TYPE "CrowdStatus" AS ENUM ('OK', 'CROWDED', 'VERY_CROWDED', 'CLOSED', 'BLOCKED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "SafetyStatus" AS ENUM ('SAFE', 'EVACUATING', 'EVACUATED', 'INJURED', 'ISOLATED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "device_settings" (
  "device_hash" TEXT NOT NULL,
  "transfer_code" TEXT,
  "saved_places" JSONB,
  "hazard_alert_prefs" JSONB,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "device_settings_pkey" PRIMARY KEY ("device_hash")
);

CREATE TABLE IF NOT EXISTS "safety_status" (
  "id" TEXT NOT NULL,
  "device_hash" TEXT NOT NULL,
  "status" "SafetyStatus" NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_known_lat" DOUBLE PRECISION,
  "last_known_lon" DOUBLE PRECISION,
  CONSTRAINT "safety_status_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "safety_status_device_hash_key" UNIQUE ("device_hash"),
  CONSTRAINT "safety_status_device_hash_fkey" FOREIGN KEY ("device_hash")
    REFERENCES "device_settings"("device_hash") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "crowd_reports" (
  "id" TEXT NOT NULL,
  "site_id" UUID NOT NULL,
  "status" "CrowdStatus" NOT NULL,
  "comment" TEXT,
  "device_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crowd_reports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crowd_reports_site_id_fkey" FOREIGN KEY ("site_id")
    REFERENCES "evac_sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "crowd_reports_site_id_created_at_idx"
  ON "crowd_reports"("site_id", "created_at");

CREATE INDEX IF NOT EXISTS "crowd_reports_device_hash_created_at_idx"
  ON "crowd_reports"("device_hash", "created_at");
