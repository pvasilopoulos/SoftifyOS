# ADR 0008 — Sales orders

## Status
Accepted — 2026-07-30

## Context
Products and invoices exist. Sales flow needs an order document that can
reference catalog SKUs and later issue an invoice.

## Decision
- `Order` + `OrderLine` tenant-scoped; optional `productId` on lines
- Status: DRAFT | CONFIRMED | INVOICED | CANCELLED
- Number format `ΠΑΡ-YYYY-#####`
- `POST /api/orders/:id/invoice` creates Invoice (ISSUED) from order lines,
  links `invoice.orderId`, marks order INVOICED
- UI at `/orders` (list / new / detail)

## Consequences
Inventory can later decrement on confirm/fulfill. Purchasing remains separate.
