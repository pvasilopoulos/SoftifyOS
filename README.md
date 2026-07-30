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
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) · login UI at `/login`.

Postgres (for next milestone):

```bash
docker compose up -d
```

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

## Roadmap after Template v2

1. Tenant model + auth + RLS
2. Cursor list APIs + 1M-row seed/benchmark
3. Phase 1 ERP modules (Master Data → Sales → Inventory → Purchasing → Finance light)
