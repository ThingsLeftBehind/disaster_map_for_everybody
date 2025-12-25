# AI Agent Guide (Canonical)

> **CRITICAL**: This is the SINGLE SOURCE OF TRUTH for all AI agents working on this repository.
> If `AGENTS.md` exists, ignore it; it is a redirect to this file.

## 🚨 Core Rules

1. **Plan Before Code**:
   - NEVER start coding without a clear plan.
   - For complex tasks, write a plan in `task.md` or `implementation_plan.md` first.
   - **Discovery First**: Read files before assuming their content. Do not invent endpoints.

2. **Minimal Changes**:
   - Make the smallest possible change to satisfy the request.
   - **NO Refactors** unless explicitly requested.
   - Preserve existing code styling and conventions.

3. **Acceptance Criteria**:
   - All PRs/Outputs must be verified against explicit criteria.
   - "It works" is not enough; list *what* was checked.
   - Format:
     ```markdown
     - [ ] Checked X on Screen Y
     - [ ] Verified API Z returns 200
     ```

## 🎨 UX & Design Principles

- **Sleek & Simple**: Priority is usability during disasters. High contrast, clear text, large buttons.
- **Lightweight**: Minimal assets. Fast loading is life-saving.
- **Map Policy**:
  - Hazard overlays default **OFF** (prevent panic).
  - Clear disclaimers visible on map layers.
  - markers: Cluster if > 50 items.

## 📱 Mobile App Specifics (Expo/React Native)

**Privacy & Push (Strict)**:
- **No GPS Storage**: Do NOT store raw user coordinates on the server.
- **Grid Subscriptions**: Devices subscribe to "Cells" (Coarse Grid).
- **Max Cells**: 12 subscribed cells per device.
- **Deduplication**: 12-hour silence for same (cell, eventType, severity).
  - Exception: Severity UPGRADE (e.g., Advisory -> Warning) sends immediately.

**Offline & Caching**:
- **Shelters**: Cache "My Area" + Last 3 searches.
- **Cap**: 50MB Soft Limit (LRU eviction).
- **TTL**: 14 days (unless Pinned by user).
- **Refresh**: Check `dataVersion` on server; only fetch if changed.

## ⚙️ Backend & API

- **DB**: Supabase (Postgres). Schema source of truth is `packages/db/prisma/schema.prisma`.
- **Endpoints**: Reuse existing `apps/web` API routes whenever possible.
- **Push Jobs**: Vercel Cron is preferred over Supabase Scheduled Functions.

---
*Last Updated: 2025-12-24*
