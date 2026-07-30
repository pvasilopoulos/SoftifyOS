# ADR 0003 — Phase 0 Platform (Tenancy + Auth + RLS)

## Status
Accepted — 2026-07-30

## Context
Template v2 UI is locked. SoftifyOS requires multi-tenant isolation before ERP modules.

## Decision
1. **PostgreSQL + Prisma** for schema/migrations and typed writes
2. **Shared DB / shared schema** with `tenant_id` on all tenant-scoped tables
3. **Cookie session (JWT via jose)** — httpOnly, secure in production
4. **Memberships + roles**: OWNER | ADMIN | MEMBER | VIEWER
5. **Postgres RLS** as defense-in-depth (`app.tenant_id` session setting)
6. App middleware sets tenant context on every DB-bound request path

## Demo seed
- Tenant: `akropolis` (Ακρόπολις ΑΕ)
- User: `maria@akropolis.gr` / `SoftifyOS!2026`
- Role: OWNER

## Out of scope (next)
- SSO / OAuth providers
- Email verification / password reset flows
- 1M-row load test
- Full RBAC object permissions
