# Mobile App Implementation Plan

## 1. API Endpoint Inventory
The mobile app will consume these existing Web APIs.

| Feature category | Method | Route Path | File Path (`apps/web/pages/api/...`) | Query Params | Used By (Web) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Nearby Shelters** | GET | `/api/shelters/nearby` | `shelters/nearby.ts` | `lat`, `lon`, `limit`, `radiusKm`, `hideIneligible` | `main.tsx` |
| **Shelter Search** | GET | `/api/shelters/search` | `shelters/search.ts` | `q`, `area`, `hazardTypes`, `limit`, `offset` | `list.tsx`* |
| **Shelter Detail** | GET | `/api/shelters/[id]` | `shelters/[id].ts` | - | `shelters/[id].tsx` |
| **Saved Shelters** | GET | `/api/shelters/batch` | `shelters/batch.ts` | `ids` (comma sep) | `main.tsx` |
| **JMA Alerts** | GET | `/api/jma/warnings` | `jma/warnings.ts` | `area` (code) | `alerts.tsx` |
| **JMA Status** | GET | `/api/jma/status` | `jma/status.ts` | - | `alerts.tsx` |
| **JMA National** | GET | `/api/jma/urgent` | `jma/urgent.ts` | - | `main.tsx` |
| **Quakes** | GET | `/api/jma/quakes` | `jma/quakes.ts` | `limit` | `quakes.tsx`* |
| **Checkins (Get)** | GET | `/api/store/checkins` | `store/checkins/checkins.ts`* | `includeHistory`, `status` | `main.tsx` |
| **Checkins (Post)**| POST | `/api/store/checkins/report`| `store/checkins/report.ts` | `deviceId`, `pinId` | `main.tsx` |
| **Ref (Muni)** | GET | `/api/ref/municipalities`| `ref/municipalities.ts`| - | `alerts.tsx` |

*> Inferred from file structure and listing.*

---

## 2. Implementation Batches

### Batch 1: Scaffold & Workspace Wiring
**Goal**: Initialize Expo project within monorepo and ensure it runs.
- [ ] Initialize `apps/mobile` (Expo + TypeScript).
- [ ] Configure `turbo.json` (or script runners) to include mobile.
- [ ] Add `apps/mobile/README.md` with run instructions.
- [ ] Install shared packages (`@jp-evac/shared`) into mobile.

**Verification**:
- Run `npm run dev --filter=mobile` -> Expo starts.
- Import a constant from `packages/shared` and log it in App.tsx.

### Batch 2: 5-Tab UI Skeleton
**Goal**: Mirror Web UI structure.
- [ ] Install Navigation (React Navigation).
- [ ] Create Tabs:
  1. **Main**: Map View (Placeholder google map).
  2. **List**: FlatList with dummy items.
  3. **Alerts**: Warning colors/chips layout.
  4. **Quakes**: List of recent quakes.
  5. **Hazard**: Settings toggle list.
- [ ] Connect **Main Tab** to `/api/shelters/nearby` (Real Network Request).

**Verification**:
- App launches 5 tabs.
- Main tab calls API and prints JSON response to console.

### Batch 3: Offline Cache & Data Strategy
**Goal**: Implement "My Area" caching.
- [ ] create `OfflineManager` class/service.
- [ ] Implement `SQLite` or `AsyncStorage` wrapper.
- [ ] Logic: Fetch `/api/shelters/nearby` -> Save to local DB.
- [ ] Logic: On App open, load from local DB first, then background refresh.
- [ ] **New Endpoint**: If `dataVersion` API is missing, create `/api/system/version`.

**Verification**:
- Turn off network (Simulate Airplane Mode).
- Open App -> Data loads from cache.

### Batch 4: Push Notifications & Cell Logic
**Goal**: Privacy-first push.
- [ ] Implement "Geohash" or Grid logic (Client side).
- [ ] Create DB Table `push_subscriptions` (DeviceToken, CellID, Platform).
- [ ] Create API `POST /api/push/register` (Upsert token + subscriptions).
- [ ] Setup Vercel Cron job `api/cron/process-alerts`.
- [ ] Implement Dedupe Logic (12h rule) in Cron.

**Verification**:
- Postman `POST /api/push/register`.
- Trigger Cron manually using Vercel dashboard or curl.
- Verify "Mock Push" log in server console.
