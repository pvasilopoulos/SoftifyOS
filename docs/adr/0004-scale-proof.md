# ADR 0004 — Scale proof (1M+ rows, cursor pagination)

## Status
Accepted — 2026-07-30

## Context
SoftifyOS targets multi-tenant workloads with 1M+ rows on hot tables.

## Decision
1. Hot table for proof: `audit_events` (already indexed by tenant + time)
2. **Keyset/cursor pagination only** for lists — never OFFSET in product APIs
3. Seed via set-based SQL (`generate_series`) for bulk load speed
4. Covering indexes: `("tenantId", "createdAt" DESC, id DESC)`
5. SQL tuple keyset: `("createdAt", id) < (cursor...)` for deep pages
6. Benchmark gate: keyset pages **< 250ms** (observed ~1ms on 1M rows)

## Observed results (1,000,003 rows)
| Query | Latency |
|-------|---------|
| first page (50) | ~0.7ms |
| cursor after 500k | ~0.6ms |
| OFFSET 500k control | ~220ms |

## Commands
```bash
npm run db:seed           # base tenant/user
npm run db:seed:scale     # 1,000,000 audit rows (SCALE_ROWS overrides)
npm run db:scale-indexes  # covering keyset indexes
npm run db:bench          # keyset vs OFFSET control
```

## Consequences
All Phase 1 list endpoints must reuse cursor helpers / tuple keyset SQL.
Reports/aggregates use summary tables — not live scans of 1M+ fact rows.
