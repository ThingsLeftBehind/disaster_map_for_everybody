-- Add push notification persistence and per-watch-region notification preference.
ALTER TABLE "WatchRegion"
  ADD COLUMN IF NOT EXISTS "notifyEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "PushSubscription" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "deviceId" UUID NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "userAgent" TEXT,
  "disabledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "NotificationDelivery" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "deviceId" UUID NOT NULL,
  "watchRegionId" UUID,
  "fingerprint" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WatchRegion_notifyEnabled_active_idx" ON "WatchRegion"("notifyEnabled", "active");
CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX IF NOT EXISTS "PushSubscription_deviceId_idx" ON "PushSubscription"("deviceId");
CREATE INDEX IF NOT EXISTS "PushSubscription_disabledAt_idx" ON "PushSubscription"("disabledAt");
CREATE INDEX IF NOT EXISTS "NotificationDelivery_deviceId_sentAt_idx" ON "NotificationDelivery"("deviceId", "sentAt");
CREATE INDEX IF NOT EXISTS "NotificationDelivery_watchRegionId_sentAt_idx" ON "NotificationDelivery"("watchRegionId", "sentAt");
CREATE UNIQUE INDEX IF NOT EXISTS "NotificationDelivery_watchRegionId_fingerprint_channel_key" ON "NotificationDelivery"("watchRegionId", "fingerprint", "channel");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PushSubscription_deviceId_fkey'
  ) THEN
    ALTER TABLE "PushSubscription"
      ADD CONSTRAINT "PushSubscription_deviceId_fkey"
      FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'NotificationDelivery_deviceId_fkey'
  ) THEN
    ALTER TABLE "NotificationDelivery"
      ADD CONSTRAINT "NotificationDelivery_deviceId_fkey"
      FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'NotificationDelivery_watchRegionId_fkey'
  ) THEN
    ALTER TABLE "NotificationDelivery"
      ADD CONSTRAINT "NotificationDelivery_watchRegionId_fkey"
      FOREIGN KEY ("watchRegionId") REFERENCES "WatchRegion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
