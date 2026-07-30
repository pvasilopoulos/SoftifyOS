# ADR 0004 — Scale proof (1M+ rows, cursor pagination)

## Status
Accepted — 2026-07-30

## Context
SoftifyOS targets multi-tenant workloads with 1M+ rows on hot tables.

## Decision
1. Hot table for proof: `audit_events` (already indexed by tenant + time)
2. **Keyset/cursor pagination only** for lists — never OFFSET in product APIs
3. Seed via set-based SQL (`generate_series`) for bulk load speed
4. Benchmark gate (local/dev): keyset page queries ideally **< 200ms**
5. API pattern: `GET /api/audit-events?limit=50&cursor=...`

## Commands
```bash
npm run db:seed          # base tenant/user
npm run db:seed:scale    # 1,000,000 audit rows (SCALE_ROWS overrides)
npm run db:bench         # keyset vs OFFSET control
```

## Consequences
All Phase 1 list endpoints must reuse `src/shared/lib/cursor.ts`.
Reports/aggregates use summary tables — not live scans of 1M+ fact rows.
