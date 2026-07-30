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

### Document kinds (expanded)
Sales: quote, order, invoice, retail receipt, credit, delivery note  
Purchasing: purchase order, goods receipt, purchase invoice/credit  
Cash: customer receipt, supplier payment  
Inventory: stock transfer / receipt / issue  
Other: cancellation  

Kinds declare intent; modules wire up issuance over time. Settings filters
group by `documentKindGroup` (Πωλήσεις / Αγορές / Αποθήκη / Χρηματικά).

## Consequences
Settings → Σειρές & Τύποι is the control plane for document behaviour.
Demo seed (`npm run db:seed:series`) upserts metadata but never resets
`nextNumber` / `lastYear` on existing series.

Create forms (τιμολόγιο / παραγγελία / έκδοση από παραγγελία) expose a
**Σειρά** picker; API accepts optional `seriesId` and falls back to default.
`Invoice.kind` distinguishes `SALES_INVOICE` / `SALES_CREDIT` / `RETAIL_RECEIPT`
while sharing the same workspace and numbering engine.
