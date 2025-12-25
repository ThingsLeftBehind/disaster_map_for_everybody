# Disaster Map for Everybody (Rescue Nav)

A Japan-wide disaster evacuation web application built with Next.js, Supabase, and Prisma.
Provides search for nearby shelters, hazard maps, and real-time JMA (Japan Meteorological Agency) alerts.

## 🚀 Projects

- **apps/web**: Next.js 14 Web Application (App Router + Pages Router mixed)
- **apps/mobile**: React Native Expo App (Coming Soon - See `docs/MOBILE_APP_SPEC_v1.md`)
- **packages/shared**: Shared constants and types
- **packages/db**: Prisma schema and DB client
- **packages/importer**: CSV Import usage

## 🛠 Tech Stack

- **Framework**: Next.js 14
- **Database**: Supabase (PostgreSQL)
- **ORM**: Prisma
- **Maps**: Leaflet (via React-Leaflet) / GSI Maps (Geospatial Information Authority of Japan)
- **Styling**: Tailwind CSS
- **Deployment**: Vercel (Web)

## ⚡️ Local Development

### Prerequisites

- Node.js (v18+)
- Postgres Database (Supabase recommended)

### Setup

1. **Environment Variables**:
   Copy `.env.example` to `.env` in `apps/web` and `packages/db`.
   ```bash
   cp apps/web/.env.example apps/web/.env
   # Fill in DATABASE_URL and NEXT_PUBLIC_... variables
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Database Setup**:
   This project uses Prisma used for schema management.
   ```bash
   # Generate Prisma client
   npx prisma generate

   # Push schema to DB (Development)
   npx prisma db push
   ```

4. **Run Web App**:
   ```bash
   npm run dev --filter=web
   ```
   Access at `http://localhost:3000`.

5. **Run Mobile App** (Future):
   *Placeholder - See Batch 1 Plan*
   ```bash
   # npm run dev --filter=mobile
   ```

## 📦 Data Import

Shelter data is imported from CSVs via the `packages/importer` script.

```bash
# Example usage (check packages/importer/README.md if available)
npm run import --filter=importer
```

## 📱 Mobile App

The mobile app is currently in the planning/scaffolding phase.
- **Spec**: [docs/MOBILE_APP_SPEC_v1.md](./docs/MOBILE_APP_SPEC_v1.md)
- **Plan**: [docs/MOBILE_APP_IMPLEMENTATION_PLAN.md](./docs/MOBILE_APP_IMPLEMENTATION_PLAN.md)

## 📄 Documentation

- [AGENT.md](./AGENT.md): Development Rules & AI Guide
