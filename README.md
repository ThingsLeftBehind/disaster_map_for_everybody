# JP Nationwide Evacuation Finder (Japan) — Web + Mobile App

Japan-wide evacuation & disaster information product.
- Web: Next.js + Leaflet
- DB: Supabase Postgres + Prisma
- Data: manual CSV refresh (per-prefecture files)
- Next: Dedicated mobile app (React Native + Expo) for push + offline

This repo is the **source of truth** for:
1) Shelter data schema + ingestion
2) Public API endpoints consumed by web (and later mobile)
3) Caching/aggregation logic for JMA alerts and hazard overlays (reference)

---

## Current (Web)
Primary user flows:
- Nearest shelters from current location (distance sorted) + map
- Searchable shelter list (pref/municipality/keyword + hazard filters) + map
- Shelter detail page with attributes + hazard chips
- Hazard map overlays (reference-only)
- JMA alerts (warnings + advisories) view

Non-functional constraints:
- Fast UI, minimal permissions
- Production hardening: no debug UI, no console spam, no repeated tile 404 spam
- Data integrity: avoid duplicates, preserve rich attributes

---

## Next (Mobile App) — Final Direction
We are building a dedicated app to avoid “web in wrapper”.
Target stack: **React Native + Expo** (single codebase for iOS/Android).

Mobile must-have:
- Push notifications (JMA warnings/advisories)
- Offline shelter access (cached shelters + last-known alerts snapshot)
- Background refresh with minimal server load and minimal privacy risk

### Push / Background policy (minimal risk)
- Radius: fixed **30km**
- Subscription unit: **area cells only** (no raw GPS stored server-side)
- Cell resolution: **H3 res=5** (or equivalent)
- Subscription cap: **max 12 cells / device**
- Dedupe: suppress duplicates **within 12 hours** per (event or cell)
- Escalation: if severity upgrades, notify even within 12 hours
- Device privacy: server stores **no latitude/longitude**, only cell IDs + token

---

## Repository layout
- `apps/web` — Next.js web app + API routes (`apps/web/pages/api/**`)
- `packages/db` — Prisma schema/client (Postgres)
- `packages/importer` — CSV ingestion logic used by `npm run import`
- `packages/shared` — shared types/constants (hazard keys, labels, etc)
- `scripts` — entrypoints (ex: `scripts/import-all.ts`)
- `data` — CSV inputs + importer progress file

---

## Prerequisites
- Node.js **20+** recommended (18+ minimum)
- npm 10+
- Supabase Postgres project (or any Postgres)

---

## Environment variables
Create a root `.env` with:
- `DATABASE_URL` (PgBouncer URL is OK for runtime)
- `DIRECT_DATABASE_URL` (direct 5432 URL recommended for migrations)

Example (format only):
DATABASE_URL="postgresql://..."
DIRECT_DATABASE_URL="postgresql://..."

---

## Install
npm install

---

## Prisma (generate / migrate)
Generate Prisma client:
npx prisma generate --schema packages/db/prisma/schema.prisma

Migrate (if you use migrations):
npx prisma migrate dev --schema packages/db/prisma/schema.prisma

---

## Import shelter CSVs (manual refresh)
Importer supports:

### A) Per-prefecture mode (recommended)
Place files in `data/` like:
- `01000_1.csv`, `01000_2.csv`, ... up to all prefectures

Meaning:
- `_1.csv` = emergency evacuation places (attributes such as accepted persons, notes, etc)
- `_2.csv` = designated shelters with hazard columns (flood/tsunami/quake/etc)

Run:
npm run import

Progress tracking:
- importer reads/writes `data/.import-progress.json`
- used to resume after interruption (skip completed prefecture batches)

### B) National fallback mode
If per-prefecture files are absent, importer may read:
- `data/evacuation_space_all.csv`
- `data/evacuation_shelter_all.csv`

Run:
npm run import

---

## Run web locally
npm run dev

---

## Operational notes (important)
- Shelters can be added/removed in source CSV updates.
- Deletions must be handled safely so removed shelters do not appear in primary UX.
- If an import is interrupted, resume should not create duplicates or partial-state hazards.

---

## For agents / Codex contributors
See:
- `AGENT.md` (canonical runbook: plan-first, minimal diffs, deterministic verification)
- `AGENTS.md` (kept consistent with AGENT.md if needed)

When asked to implement changes:
1) plan first (files + steps + acceptance checks)
2) then implement exact diffs
3) provide deterministic manual verification steps (URLs + expected results)
