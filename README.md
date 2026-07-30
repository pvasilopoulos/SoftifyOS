# SoftifyOS

Enterprise ERP platform — **Template v2 (Desktop + Mobile)** locked.

## What's in this template

- Responsive app shell: desktop sidebar + mobile bottom tabs
- Command palette (`⌘K`) / mobile quick actions sheet
- Dashboard with work queue + KPIs
- Invoices workspace (list + detail + desktop preview) as reference pattern
- Softify design system (slate / teal / ink, IBM Plex Sans)
- Multi-tenant ready folder structure (`platform/`, `modules/`, `shared/`)
- ADR: [`docs/adr/0001-template-v2.md`](docs/adr/0001-template-v2.md)

## Quick start

```bash
cp .env.example .env
# start Postgres (docker compose up -d  OR local Postgres)
npm install
npm run db:migrate
npm run db:seed
npm run db:rls
npm run dev
```

Open [http://localhost:3000/login](http://localhost:3000/login)

Demo: `maria@akropolis.gr` / `SoftifyOS!2026`

## Phase 0 platform

- Tenants + memberships (OWNER/ADMIN/MEMBER/VIEWER)
- Cookie JWT sessions (`jose`) + protected app routes
- Audit events on login/logout
- Postgres RLS policies (`prisma/sql/rls.sql`)
- ADR: [`docs/adr/0003-phase0-platform.md`](docs/adr/0003-phase0-platform.md)

## Stack

| Layer | Choice |
|-------|--------|
| App | Next.js App Router + TypeScript |
| UI | Tailwind + Softify tokens |
| Icons | lucide-react |
| DB (next) | PostgreSQL 16 + Prisma |

## Performance & stability

Baseline rules live in [`docs/adr/0002-performance-stability.md`](docs/adr/0002-performance-stability.md):

- Route loading skeletons + error / not-found recovery
- Lucide import optimization, Strict Mode, security headers
- Deferred list filtering + `content-visibility` rows
- Health check: `GET /api/health`
- Gate: `npm run check` (lint + typecheck + build)

## Scale proof (1M+)

```bash
npm run db:seed:scale   # inserts 1,000,000 audit_events
npm run db:bench        # keyset vs OFFSET timing
```

- API: `GET /api/audit-events?limit=50&cursor=...`
- UI: `/audit`
- ADR: [`docs/adr/0004-scale-proof.md`](docs/adr/0004-scale-proof.md)

## Roadmap after Template v2

1. ~~Tenant model + auth + RLS~~ ✅ Phase 0
2. ~~Cursor list APIs + 1M-row seed/benchmark~~ ✅ Scale proof
3. ~~Master Data: Customer → Branch → Space~~ ✅ Phase 1 start
4. Phase 1 continued: Products → Sales documents → Inventory
