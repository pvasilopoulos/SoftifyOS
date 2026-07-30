# ADR 0001 — SoftifyOS Template v2 (Desktop + Mobile)

## Status
Accepted — 2026-07-30

## Context
SoftifyOS needs a locked UI/platform template before business ERP modules.
Constraints: multi-tenant SaaS, 1M+ row scale readiness, Greek-first UI.

## Decision
**Template v2 = Desktop + Mobile** on a single Next.js codebase.

### Stack
- Next.js App Router + TypeScript (strict)
- Tailwind CSS + Softify design tokens (slate / teal / ink)
- IBM Plex Sans typography (Greek + Latin)
- PostgreSQL + Prisma (schema next; shell ships first)
- Zod at API boundaries (pattern)
- lucide-react icons

### Layout
| Viewport | Navigation | Quick actions |
|----------|------------|---------------|
| Desktop (≥1024px) | Left sidebar + top bar | `⌘K` command palette |
| Mobile (<1024px) | Bottom tabs + compact top | Bottom sheet «Γρήγορες ενέργειες» |

### Included in template
- App shell (responsive)
- Login screen
- Dashboard with work queue + KPIs
- Invoices list/detail as reference data workspace
- Tenant switcher placeholder
- Notifications placeholder
- Command palette / mobile quick actions
- Design tokens + shared UI primitives

### Non-negotiables (carry into modules)
1. Every business table has `tenant_id`
2. Cursor pagination for lists
3. Indexes start with `(tenant_id, …)`
4. Module folder contract: `domain / application / infrastructure / api / ui`
5. Greek-first labels with i18n-ready copy helpers later

### Out of scope for Template v2
- Real auth provider wiring
- Prisma schema / RLS
- Full Sales/Inventory/Finance domains
- 1M-row seed / load tests (next milestone)

## Consequences
All new screens must reuse the shell, tokens, and list/detail patterns.
Visual direction follows mockups v2 (modern Linear×Stripe enterprise, not purple/cream AI defaults).
