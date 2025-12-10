Follow README and build MVP in phases.

Architecture overview:
- Monorepo with workspaces: apps/web (Next.js UI + API routes), packages/db (Prisma client and schema), packages/importer (CSV ingestion helpers), packages/shared (shared constants/utilities), and scripts (entry points such as import-all.ts).
- PostgreSQL/Supabase is the target DB; Prisma manages schema and access. Leaflet renders maps from API data rather than committed GeoJSON.

Conventions:
- Use TypeScript across packages, Zod for input validation, and keep hazards keyed by hazardKeys in @jp-evac/shared.
- Prefer functional React components with Tailwind utility classes.
- Avoid storing large GeoJSON files in the repo; generate map data from DB queries.

MVP checklist:
- MVP1: map/search/filter UI wired to /api/shelters/nearby with device bootstrap.
- MVP2: crowd reporting endpoints and 60-minute summary surfaced in the detail panel.
- MVP3: safety status endpoints and transfer code flow persisting device state.
