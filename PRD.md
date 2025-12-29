# PRD: HinaNavi Mobile (Batch Plan)

## 1) Product Overview
Goal:
- Background location + push for JMA/earthquake alerts.
- Tapping a push opens the app and immediately shows nearby shelters.

Principles:
- Minimal server load.
- Privacy-first.
- Offline-first for shelters.
- Graceful degradation for alerts/quakes.

UX:
- Black & white base.
- Simple, lightweight.
- No debug UI in production.

Checklist:
- [ ] Push tap opens to Main and triggers nearby shelter fetch.
- [ ] Shelters usable offline.
- [ ] Alerts/quakes show degraded state if stale.

## 2) Navigation / Screens (5-Tab, Fixed)
Tabs:
- Main: current location nearby shelters + map + list.
- List: search (pref/muni/keyword + hazard filters) + map/list.
- Alerts: JMA warnings/advisories/special warnings (Tokyo mainland/islands grouping).
- Quakes: recent list + "strong shaking" card/list.
- Hazard: hazard layers (default off) + always-on layer cautions.

Additional (non-tab or within Settings):
- Disclaimer.
- Sources.
- Settings.

Checklist:
- [ ] 5-tab layout is fixed.
- [ ] Disclaimer and Sources are reachable from Settings.

## 3) Backend/API Reuse Strategy
Production API base URL:
- https://www.hinanavi.com

Dev strategy:
- Simulator: http://localhost:3000 (if running web backend locally).
- Physical device: use LAN IP or tunnel.
  - Example: set `EXPO_PUBLIC_API_BASE_URL=http://192.168.x.x:3000` or a tunnel URL.

Environment variable contract:
- `EXPO_PUBLIC_API_BASE_URL` (required).

Endpoints (reuse existing web routes as-is):
- `/api/shelters/nearby`
- `/api/shelters/search`
- `/api/shelters/[id]`
- `/api/jma/status`
- `/api/jma/warnings` (by area code)
- `/api/jma/quakes` (or current quakes endpoint used by web)
- `/api/gsi/hazard-layers` (if needed)

Checklist:
- [ ] No breaking changes to existing web API response shapes.
- [ ] Mobile uses the same routes with a different base URL.

## 4) Mobile Architecture Decision (Expo Router Fixed)
Apps/mobile folder layout proposal:
- `apps/mobile/app/(tabs)/main.tsx`
- `apps/mobile/app/(tabs)/list.tsx`
- `apps/mobile/app/(tabs)/alerts.tsx`
- `apps/mobile/app/(tabs)/quakes.tsx`
- `apps/mobile/app/(tabs)/hazard.tsx`
- `apps/mobile/app/(stack)/sources.tsx`
- `apps/mobile/app/(stack)/disclaimer.tsx`
- `apps/mobile/app/(stack)/settings.tsx`
- `apps/mobile/src/api/` (typed client, base URL, retries, timeouts)
- `apps/mobile/src/storage/` (offline cache interfaces + implementations)
- `apps/mobile/src/push/` (registration + subscription management)
- `apps/mobile/src/location/` (foreground/background policies)
- `apps/mobile/src/ui/` (shared components)
- `apps/mobile/src/domain/` (types, mappers)

State management:
- Keep simple: React state + minimal context.
- Avoid heavy libraries unless necessary.

Map:
- `react-native-maps` as default.

Checklist:
- [ ] Expo Router is the fixed navigation solution.
- [ ] No heavy state libraries without clear need.

## 5) Offline/Cache Strategy (Shelters First)
Shelters:
- Must work without network.
- Use SQLite (`expo-sqlite`) as the primary store for shelter records + indexes.
- First fetch from server, then persist locally.
- Cache invalidation driven by a "data version/updatedAt" endpoint.
  - If missing, define a minimal contract:
    - `GET /api/shelters/version` -> `{ version: string, updatedAt: string }`
    - Clients refresh when version changes or `updatedAt` is newer than local.

Alerts/quakes:
- Store last successful snapshot in AsyncStorage.
- If fetch fails, show "Outdated" with last updated time.

Checklist:
- [ ] Shelters are readable offline from SQLite.
- [ ] Alerts/quakes show last known data with "Outdated" label if stale.

## 6) Push + Background Location (Must-Have)
Background location:
- Enabled only with explicit user consent, but required for core features.

Subscription model:
- Max 12 "cells" (H3 res 5) per device.

Trigger:
- 12 hours or 2km moved (best-effort by platform capabilities).

Dedupe:
- Same event (`eventId` OR `cell+category+level`) suppressed for 12h.

Escalation:
- Advisory -> Warning -> Special bypasses dedupe and sends immediately.

Push tap:
- Deep-link opens app to Main and runs nearby shelter fetch immediately.

Checklist:
- [ ] Dedupe is enforced, escalation bypasses dedupe.
- [ ] Push opens Main and triggers immediate nearby fetch.

## 7) Cross-Prefecture Alert Coverage (Boundary Users)
Approach A: Area-code based (pref) only
- Lowest load, simplest to implement.
- Risk: boundary users may miss nearby neighboring prefecture alerts.

Approach B: Distance-based nearby prefectures/areas
- Better coverage near boundaries.
- Higher complexity and load (compute nearby areas per device).

Recommended default:
- Start with Approach A for stability and minimal server load.
- Add Approach B only if boundary misses become a documented issue.

Checklist:
- [ ] Default uses Approach A.
- [ ] Approach B is reserved for later iteration.

## 8) Batch Milestones (1-4) + Acceptance Tests
Batch 1: Project bootstrap + navigation skeleton
- Deliverables:
  - Expo app scaffold at `apps/mobile`.
  - Expo Router tabs + stack routes wired.
  - Basic theming (black & white).
- Acceptance tests:
  - Run `pnpm --filter @jp-evac/mobile dev` and confirm 5 tabs render.
  - Navigate to Disclaimer/Sources/Settings screens from Settings.

Batch 2: Data layer + shelters
- Deliverables:
  - API client using `EXPO_PUBLIC_API_BASE_URL`.
  - Shelters: nearby + search + detail.
  - SQLite cache for shelters.
- Acceptance tests:
  - Simulate offline and confirm cached shelters still show.
  - Fetch nearby shelters and confirm it uses `/api/shelters/nearby`.

Batch 3: Alerts + quakes + hazard layers
- Deliverables:
  - Alerts (JMA warnings) with Tokyo mainland/islands grouping.
  - Quakes list + strong shaking card.
  - Hazard layers list and map toggle (default off).
  - AsyncStorage snapshots for alerts/quakes.
- Acceptance tests:
  - Disable network and confirm alerts/quakes show "Outdated".
  - Toggle hazard layers and verify layer cautions are always shown.

Batch 4: Push + background location + offline polish
- Deliverables:
  - Push registration + cell subscription.
  - Background location trigger (12h or 2km).
  - Deep-link on push to Main with immediate nearby fetch.
  - Dedupe + escalation rules.
- Acceptance tests:
  - Receive test push and verify deep-link to Main + auto-fetch.
  - Trigger an escalation event and confirm it bypasses dedupe.

Checklist:
- [ ] Each batch has concrete acceptance tests.
- [ ] Batch 4 meets push + background location requirements.

## 9) Verification Commands (Batch 0)
Use these after Batch 0 to confirm the doc exists and nothing else changed:
- `ls -la PRD.md`
- `head -n 20 PRD.md`
- `git status --short`
