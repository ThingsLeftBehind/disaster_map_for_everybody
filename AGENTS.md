Follow README for current v2 architecture.

Architecture overview:
- Monorepo workspaces: apps/web (Next.js UI + API routes), packages/db (Prisma schema/client), packages/importer (CSV ingestion), packages/shared (types and utilities), scripts (entry points such as import-all.ts).
- PostgreSQL/Supabase with Prisma 5 and pgbouncer-friendly dual URLs (DATABASE_URL for runtime, DIRECT_DATABASE_URL for migrations).
- Leaflet renders map tiles dynamically; data is loaded from API queries rather than bundled GeoJSON.

Conventions:
- Use TypeScript and Zod across packages. Hazard keys come from @jp-evac/shared.
- Prefer functional React components with Tailwind utility classes and no inline comments.
- Keep device identity anonymous via hashed device_hash stored in cookies/local storage; no user accounts.

v2 surface areas:
- Importer normalizes headers, logs dataset metadata, and upserts evac_site with hazard capabilities from the two CSVs in /data.
- API routes under apps/web/pages/api provide nearby search, shelter detail, status reporting, safety status, device transfer, watch regions, and hazard risk stubs.
- Frontend home screen pairs map + list with filters, hazard badges, status reporting, safety status, transfer code, and watch region management with shared disclaimer.
