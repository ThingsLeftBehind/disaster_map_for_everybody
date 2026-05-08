# Operations: Cleanup API

## Environment variable
- `CLEANUP_SECRET` (required)

Do not commit this value. Set it in deployment environment variables (for example, Vercel project settings).

## Endpoint
- `GET|POST /api/admin/cleanup`

Auth (either one):
- `Authorization: Bearer <CLEANUP_SECRET>`
- `x-cleanup-secret: <CLEANUP_SECRET>`

## Dry-run and execute

Dry-run (recommended first):
```bash
curl -i \
  -H 'Authorization: Bearer <CLEANUP_SECRET>' \
  'https://<your-host>/api/admin/cleanup?dryRun=true'
```

Execute:
```bash
curl -i -X POST \
  -H 'Authorization: Bearer <CLEANUP_SECRET>' \
  'https://<your-host>/api/admin/cleanup?dryRun=false'
```

## Cleanup rules

### SafetyStatus
- hard delete rows where `deletedAt < now - 7 days`
- hard delete rows where `expiresAt < now - 7 days`

### SiteStatusReport
- hard delete rows where `deletedAt < now - 7 days`
- hard delete rows where `reportedAt < now - 10 days`

## Never deleted by this API
- `EvacSite` rows
- `Device` rows

## Response shape
- `ok`
- `dryRun`
- `deletedSafetyStatusCount`
- `deletedSiteStatusReportCount`
- `cutoffs`
- `errors`

When `dryRun=true`, counts are the rows that match the filters (would be deleted).

## Suggested schedule
- Daily (once per day).
- Run dry-run first after deployment, then execute if counts look correct.

# Operations: PWA / Web Push

## Environment variables
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (client public key)
- `VAPID_PRIVATE_KEY` (server only)
- `VAPID_SUBJECT` (for example `mailto:ops@example.com`)
- `CLEANUP_SECRET` or `CRON_SECRET` for protected admin push endpoints

Do not commit private keys. Generate VAPID keys with:

```bash
npx web-push generate-vapid-keys
```

## PWA
- Manifest: `/manifest.webmanifest`
- Service worker: `/sw.js`
- Start URL: `/main`

The service worker does not cache JMA or shelter APIs as fresh data. If navigation fails offline, the app shows:
`オフラインです。最新情報を取得できません。`

## Push endpoints
- `GET /api/push/vapid-public-key`
- `POST /api/push/subscribe`
- `POST /api/push/unsubscribe`
- `GET /api/push/status?deviceId=<local-device-id>`

These endpoints never return `VAPID_PRIVATE_KEY`, database device IDs, or transfer codes.

## Admin test push

```bash
curl -i -X POST \
  -H 'Authorization: Bearer <CLEANUP_SECRET_OR_CRON_SECRET>' \
  'https://<your-host>/api/admin/push-test'
```

Sends only a test notification:
- title: `避難ナビ 通知テスト`
- body: `通知の準備が完了しています。`

Expired browser subscriptions returning 404/410 are disabled.

## Warning check push

Dry-run is the default:

```bash
curl -i \
  -H 'Authorization: Bearer <CLEANUP_SECRET_OR_CRON_SECRET>' \
  'https://<your-host>/api/admin/push-check-warnings?dryRun=true'
```

Execute manually after reviewing dry-run output:

```bash
curl -i -X POST \
  -H 'Authorization: Bearer <CLEANUP_SECRET_OR_CRON_SECRET>' \
  'https://<your-host>/api/admin/push-check-warnings?dryRun=false'
```

The warning checker:
- checks active `WatchRegion` rows where `notifyEnabled=true`
- sends only when active JMA warnings/advisories exist
- stores `NotificationDelivery` fingerprints
- skips duplicate fingerprints for the same registered place/channel

Recommended schedule: start with manual dry-runs, then use a moderate cron interval only after duplicate behavior is confirmed in production logs.
