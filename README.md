# JP Nationwide Evacuation Finder

Next.js + Leaflet MVP for exploring Japan-wide evacuation locations, powered by Supabase/PostgreSQL and Prisma. Two public CSVs in `/data` are ingested into the database.

## Repository layout
- `apps/web`: Next.js 14 app (pages router) with Tailwind UI, hazard filters, map/list view, and API routes.
- `packages/db`: Prisma schema/client for Postgres.
- `packages/importer`: CSV ingestion helpers used by the import script.
- `packages/shared`: Hazard keys, labels, and shared utilities.
- `scripts`: Automation such as `import-all.ts`.

## Prerequisites
- Node.js 18+
- npm 10+
- PostgreSQL (Supabase recommended)

## Supabase quickstart
1. Create a new Supabase project.
2. In the SQL editor, enable the `uuid-ossp` extension if needed (`create extension if not exists "uuid-ossp";`).
3. Find the project connection string and set it as `DATABASE_URL` in `.env`.

## Environment setup
1. Copy the template: `cp .env.example .env` and fill `DATABASE_URL`. Leave `NEXT_PUBLIC_NOMINATIM_URL` as provided or point to a self-hosted endpoint.
2. Install dependencies once at the repo root: `npm install`.

## Database migration
Prisma uses the schema at `packages/db/prisma/schema.prisma`.
```
npm run prisma:generate
npm run db:push
# To reset and recreate all tables locally/Supabase:
npx prisma db push --schema packages/db/prisma/schema.prisma --force-reset
```
If you use Supabase, run these against your Supabase connection string.

## Import CSV data
`/data/evacuation_space_all.csv` and `/data/evacuation_shelter_all.csv` are bundled with the repo.
```
npm run import
```
The script reads both CSVs, maps hazard flags into a JSON column, attaches shelter details when `common_id` matches, and upserts sites.

## Run the web app
```
npm run dev
```
The app runs on http://localhost:3000 with:
- My location button
- Nominatim address search
- Hazard checklist and result limit selector
- Combined map + list view
- Facility detail with hazard badges, crowd summary, and disclaimer
- Crowd report submission (rate-limited per device)
- Anonymous device bootstrap with transfer code stored locally

## Safety status APIs
- `POST /api/safety/update`: upsert device settings and latest safety status
- `GET /api/safety/me?device_hash=...`: fetch stored settings + safety status

## Testing
No automated tests are wired yet. Run lint/build to catch TypeScript issues:
```
npm run lint
npm run build
```

## Notes
- Map rendering uses DB query results; avoid committing large GeoJSON files.
- Data is for support purposes. Always defer to the latest official municipal guidance.
