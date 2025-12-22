# AGENTS.md (CANONICAL) — Agent + Human Runbook

This repository contains a safety-critical, lightweight Japan-wide disaster/evacuation product.
Primary goal: **help users find the right shelter fast, even under degraded network conditions**.

> Canonical instructions live in THIS file.
> `AGENT.md` exists only as a compatibility pointer for tools that read `AGENT.md`.

---

## 0) Current product state

### Web MVP (existing)
- Stack: Next.js (pages router) + Leaflet + Supabase/Postgres + Prisma
- DB schema source of truth: `packages/db/prisma/schema.prisma`
- APIs live under: `apps/web/pages/api/**`

### Mobile App (planned, new)
- Preferred approach: React Native + Expo (single codebase for iOS/Android).
- Mobile app will consume the existing API contracts (same DB).
- Push + offline shelter viewing are first-class requirements.

---

## 1) Non-negotiables (safety + stability)

### Locked by policy (do not change casually)
Do not edit these files in normal feature work:
- `packages/db/prisma/schema.prisma`
- `packages/importer/src/index.ts`

If a change is truly required, write a plan FIRST including:
1) reason
2) impact analysis
3) dry-run validation steps
4) rollback steps

### Data safety
- Treat DB as the source of truth for shelters; web/mobile clients are read-mostly.
- Any “write” features (device settings, local flags) must go through a storage adapter.
- Offline caches:
  - Runtime caches under `data/cache/**`
  - Local device storage (web) under `data/local_store/**` (or browser storage equivalents)

### UX safety
- Always show “reference only / official sources” disclaimers for hazards and realtime feeds.
- If upstream fetch fails: serve last cached snapshot and show degraded status.
- Never embed or redistribute Kyoshin Monitor; external link only.

---

## 2) Top priorities (product)
1) Nearest shelters by current location (fast, reliable)
2) Searchable shelter list (pref/municipality/keyword + filters)
3) Alerts view (JMA warnings/advisories) + “My Area” correctness (Tokyo mainland vs islands)

Mobile additions (must-have):
- Push notifications (warning/advisory) with dedupe + escalation rules
- Offline shelter viewing (last synced shelters + map/list basic)

---

## 3) API contracts (must remain stable)
Existing web app uses API routes under `apps/web/pages/api/**`.
Do NOT break these without providing compatibility.

Minimum expectations:
- Shelter search endpoints return:
  - id, name, address, lat/lng, kind (space/shelter), hazard flags, important attributes
- Alerts endpoints return:
  - event type, severity (advisory/warning/special), target area info, timestamps, source

If adding new endpoints for mobile:
- Keep them additive (new routes), do not change existing response shapes silently.

---

## 4) Mobile app architecture guideline (Expo)
- Repo layout proposal (additive, do not disturb web app):
  - `apps/mobile` (Expo app)
  - `packages/shared` reused (hazard keys/labels/utils)
- Offline:
  - Persist last-synced shelter subset by “My Area” + current location radius
  - Persist last-seen alerts snapshot
- Push:
  - Prefer low server cost: server computes “cells/areas -> tokens” mapping minimalistically
  - Dedupe: prevent repeats within time window; allow escalation notifications

---

## 5) How to work with Codex / agents
Treat Codex like a senior engineer with zero repo context:
- Always request: (1) analysis/plan, (2) file list, (3) minimal diffs, (4) acceptance criteria.
- No broad refactors unless a measured reason exists.
- Every batch MUST include:
  1) What changed (file list)
  2) Why (one sentence)
  3) Manual acceptance criteria (3–6 explicit checks)

Verification discipline:
- If a bug is reported:
  1) restate symptom in one line
  2) name 1–2 highest-probability root causes
  3) give 1–2 deterministic verification steps (exact URL + expected status/body)
  4) then propose minimal fix

---

## 6) Quick commands
- Dev: `npm run dev`
- Import shelters CSV into DB: `npm run import`
- Refresh static refs + municipalities: `npm run data:refresh`

For more details see `docs/REFRESH_PLAYBOOK.md`.

---

## 7) Secrets / env
- Do not commit real connection strings.
- Use `.env` (root) for server tasks and `apps/web/.env.local` for web runtime as needed.
