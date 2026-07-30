# ADR 0009 — Document series, sites & fiscal rules

## Status
Accepted — 2026-07-30

## Context
Invoices/orders used hard-coded prefixes. Real ERPs separate document *kind*
from tenant-configured *series* (numbering, org unit, customer/stock effects,
myDATA flags, GL accounts). SoftifyOS also needs draft edit, cancel, overdue,
payment history, SKU lines, and partial order invoicing.

## Decision
- `Site` = company branch / till (not customer branch)
- `DocumentSeries` = numbering + effects + myDATA + GL codes + `allowPartial`
- Documents (`Order`, `Invoice`) reference `seriesId` (+ optional `siteId`)
- Numbers allocated atomically via `allocateFromSeries`
- `OrderLine.quantityInvoiced` enables partial invoicing
- `InvoicePayment` stores collection history; `paidAmount` remains denormalized
- myDATA / GL are stored for later filing/posting — no live ΑΑΔΕ API yet
- Inventory *effects* are declared on series; stock engine comes with Αποθήκη

## Consequences
Settings → Σειρές & Τύποι is the control plane for document behaviour.
