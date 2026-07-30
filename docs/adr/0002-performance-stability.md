# ADR 0002 — Performance & Stability baseline

## Status
Accepted — 2026-07-30

## Context
SoftifyOS must feel fast and remain stable under enterprise use (multi-tenant, large lists later).

## Decision

### Performance
1. `optimizePackageImports` for `lucide-react` (smaller client bundles)
2. Route-level `loading.tsx` skeletons to avoid blank navigations
3. Prefer Server Components by default; client only for interactive shell/filters
4. List rows use `content-visibility: auto` for cheaper offscreen rendering
5. Search/filter updates use `startTransition` / deferred query where interactive
6. Next.js `Link` prefetch for primary nav (default)
7. Cursor pagination required for all production lists (no OFFSET)

### Stability
1. Route `error.tsx` + `global-error.tsx` with recovery CTA
2. `not-found.tsx` for unknown routes/records
3. React Strict Mode enabled
4. Security headers: `nosniff`, `Referrer-Policy`, `X-Frame-Options`
5. `/api/health` for uptime checks
6. Shared formatters must not throw on bad input
7. `npm run typecheck` + `lint` + `build` as gate before merge

## Consequences
New modules inherit loading/error boundaries and list performance patterns.
Heavy work (imports, PDFs, stock recalc) must stay on background jobs — never block UI request path.
