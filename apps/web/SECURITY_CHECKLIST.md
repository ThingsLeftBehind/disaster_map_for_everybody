# Security Checklist

## Admin protection
- Set one of:
  - `ADMIN_API_KEY`
  - `ADMIN_BASIC_USER` and `ADMIN_BASIC_PASS`
- Admin-only endpoints:
  - `/api/store/admin/banner`
  - `/api/store/admin/moderation`
- If no admin secrets are set, admin endpoints return `401`.

## Rate limits (in-memory, per IP)
- Write endpoints: 30 requests / 5 minutes
- Report endpoints: 10 requests / 10 minutes
- Admin endpoints: 60 requests / 10 minutes

## Same-origin protection
- Non-GET requests require `Origin` to match `Host` when present.

## Database boundary
- Server uses `DATABASE_URL`; RLS is not the primary defense unless you move reads/writes to client-side PostgREST calls.

## Local verification
- `npm --workspace apps/web run build`
- `npm run dev`
- `curl -i http://localhost:3000/api/store/admin/banner` (should be 401 without admin secrets)
- `curl -i -H 'x-admin-key: <your-key>' http://localhost:3000/api/store/admin/banner`
- `for i in $(seq 1 40); do curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/store/checkin -H "content-type: application/json" -d '{}' ; done` (expect 429 after limit)
