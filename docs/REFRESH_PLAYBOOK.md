# Data Refresh Playbook (No Locked File Changes)

This repo separates:
- **Static reference data** (downloaded): `data/ref/**`
- **Generated data** (derived): `data/generated/**`
- **Runtime caches** (never commit): `data/cache/**`
- **Local writes** (never commit): `data/local_store/**`

## What to run

### 1) Fetch static references (network required)
Downloads:
- JMA area constants → `data/ref/jma/const/area.json`
- GSI municipality JS → `data/ref/gsi/muni.js`

```bash
npm run data:refs
```

### 2) Generate municipalities dataset
Produces `data/generated/municipalities.json` from:
- `data/ref/admin/*.xlsx` if present (preferred), else
- `data/ref/gsi/muni.js`

```bash
npm run data:municipalities
```

### 3) Validate datasets (required)
Validates:
- `data/generated/municipalities.json` (size, counts, duplicates)
- `data/ref/jma/const/area.json` (required keys)
- `data/ref/gsi/muni.js` (non-empty, non-placeholder)

```bash
npm run data:validate
```

### 4) All-in-one (recommended)
```bash
npm run data:refresh
```

## Realtime caches (JMA/GSI)

JMA and GSI caches are request-driven and live under `data/cache/**`.
To refresh JMA caches locally, hit:
```bash
curl -s http://localhost:3000/api/jma/status
```

## What NOT to commit

These paths are intentionally ignored:
- `data/cache/**`
- `data/local_store/**`
- `data/generated/_pretty/**`

## Shelter DB updates

Shelter updates should be performed by re-running the existing importer/upsert process.
Do not edit locked files (`packages/db/prisma/schema.prisma`, `packages/importer/src/index.ts`) without a written plan (see `LOCKFILES.md`).

