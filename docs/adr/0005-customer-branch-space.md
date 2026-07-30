# ADR 0005 — Master Data: Customer → Branch → Space

## Status
Accepted — 2026-07-30

## Context
Phase 1 starts with customers. Real-world customers have multiple branches (υποκαταστήματα), and each branch has spaces (χώροι).

## Decision
Hierarchy (tenant-scoped):

```
Customer (Πελάτης)
 └── Branch (Υποκατάστημα)
      └── Space (Χώρος)
```

- Unique codes per scope: customer code / branch per customer / space per branch
- Soft operational fields: VAT, address, space type (OFFICE, WAREHOUSE, FLOOR, ROOM, YARD, OTHER)
- Lists use cursor pagination; detail pages nest children

## Consequences
Sales documents later reference Customer (and optionally Branch/Space) for delivery/service location.
