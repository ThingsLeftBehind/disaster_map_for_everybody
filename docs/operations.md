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

