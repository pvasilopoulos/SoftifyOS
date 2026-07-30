# ADR 0006 — Invoices workspace (Sales documents)

## Status
Accepted — 2026-07-30

## Context
Phase 1 needs real invoices UI matching SoftifyOS Template v2 workspace mockups,
linked to Customer → Branch → Space.

## Decision
- `Invoice` + `InvoiceLine` tenant-scoped tables
- Invoice references `customerId` (required), `branchId` / `spaceId` (optional)
- Status: DRAFT | ISSUED | PARTIAL | PAID | OVERDUE | CANCELLED
- List UI: status tabs, search, selection, right preview panel, cursor pagination
- Money fields as `Decimal(14,2)`; paid ratio = paidAmount / total

## Consequences
Orders and payments will later post into / against invoices using the same workspace patterns.
