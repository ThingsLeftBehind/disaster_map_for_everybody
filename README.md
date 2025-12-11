# JP Nationwide Evacuation Finder v2

Lightweight Next.js + Leaflet app for finding nearby evacuation shelters across Japan with hazard filters, anonymous status sharing, and device safety tracking.

## Repository layout
- `apps/web`: Next.js 14 (Pages Router) with Tailwind UI, map + list, device bootstrap, safety status, watch regions, and API routes.
- `packages/db`: Prisma 5 schema and client for Supabase/PostgreSQL (pgbouncer friendly).
- `packages/importer`: CSV ingestion helpers for the bundled datasets.
- `packages/shared`: Shared hazard keys, enums, zod schemas, and utilities.
- `scripts`: Entrypoints such as `import-all.ts`.

## Environment variables
Create a `.env` with at least:
- `DATABASE_URL` (pgbouncer/pooler URL for runtime)
- `DIRECT_DATABASE_URL` (direct Postgres URL for migrations/db push)
- `NEXT_PUBLIC_*` as needed for Next.js (no secrets in public variables)

## Setup and commands
From the repo root:
- Install: `npm install`
- Generate Prisma client: `npx prisma generate --schema packages/db/prisma/schema.prisma`
- Push schema: `npx prisma db push --schema packages/db/prisma/schema.prisma`
- Import CSV data: `npm run import`
- Start dev server: `npm run dev`

## Data import
`data/evacuation_space_all.csv` and `data/evacuation_shelter_all.csv` ship with the repo. `npm run import` finds the repo root, logs dataset metadata, normalizes headers, and upserts into `evac_site` with hazard capabilities.

## Key features
- Real-time nearby shelter search by current location or address query with hazard type filters, radius, and limit controls.
- Combined map + list UI with hazard badges, selection highlight, and detail view.
- Crowd-sourced status reports per site (混雑/通行) with recent summary and rate limiting.
- Anonymous device bootstrap with transfer code, safety status management (safe / injured / isolated / evacuating / evacuated), and optional shelter link.
- Watch regions (home/office/school) stored per device with hazard type preferences for future alerting.
- Privacy-first: no accounts, minimal cookies/local storage, and location only on explicit request.

## Disclaimer
Data is derived from public sources (GSI/municipalities, etc.) and may be outdated. Always follow official guidance during disasters and verify conditions on site.
