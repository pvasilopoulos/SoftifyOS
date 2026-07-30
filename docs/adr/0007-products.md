# ADR 0007 — Products master data

## Status
Accepted — 2026-07-30

## Context
Invoices use free-text lines. Orders and inventory need a tenant-scoped
product catalog (SKU, price, unit, VAT) before stock or order lines.

## Decision
- `Product` table: `sku` unique per tenant, `name`, `unit` (default `τεμ`),
  `vatRate`, `price`, `ACTIVE|INACTIVE`
- Cursor list API + CRUD UI at `/products`
- Keep `InvoiceLine.description` free-text for now; optional `productId` later

## Consequences
Orders and warehouse movements will reference Product. Invoice create can
later pick SKUs to prefill description/price/VAT.
