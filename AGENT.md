# Project Runbook (Agent + Human)

This repo is a safety‑critical, lightweight disaster/evacuation web app. **Fail safe, show sources, and never block core shelter search on upstream network**.

## Non‑negotiables

### Locked by policy (always)
Do not edit these files in normal feature work:
- `packages/db/prisma/schema.prisma`
- `packages/importer/src/index.ts`

If a change is truly required, write a plan first including: reason, impact analysis, dry‑run validation, and rollback.

### Data safety
- Treat the DB as the source of truth for shelters; **read-only from the web app**.
- All “write” features must go through the Storage Adapter and persist under `data/local_store/**`.
- Runtime caches must stay under `data/cache/**`.

### UX safety
- Always show “reference only” disclaimers for hazards and realtime feeds.
- If upstream fetch fails, keep serving the last cached snapshot and show degraded status.
- Never embed or redistribute Kyoshin Monitor; external link only.

## Quick commands
- Dev: `npm run dev`
- JMA/store unit tests: `npm run test:jma && npm run test:store`
- Refresh static refs + municipalities (requires network for refs): `npm run data:refresh`

For more details see `docs/REFRESH_PLAYBOOK.md`.

