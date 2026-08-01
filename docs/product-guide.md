# SoftifyOS — Οδηγός προϊόντος

Τι κάνει η εφαρμογή και πώς δουλεύει κάθε ενότητα.

> In-app: μετά το login άνοιξε **[/docs](/docs)**.  
> API παραδείγματα: **[/settings/integrations](/settings/integrations)** → API endpoints.

## Σύνοψη

Το SoftifyOS είναι ελληνικό multi-tenant ERP για:

- Πωλήσεις (προσφορές → παραγγελίες → τιμολόγια → δελτία)
- Αποθήκη & προϊόντα
- Αγορές / προμηθευτές
- Οικονομικά FI (ημερολόγιο, ισοζύγιο, AR/AP, ΦΠΑ, myDATA)
- HR (μητρώο, άδειες, ψηφιακή κάρτα, Εργάνη, μισθοδοσία)
- POS, gift cards, loyalty
- Integrations (webhooks, ΑΑΔΕ, API tokens, Script Hooks)

Κάθε tenant έχει απομονωμένα δεδομένα (`tenantId` + Postgres RLS). Ρόλοι: OWNER, ADMIN, MEMBER, VIEWER.

## Ενότητες

| Περιοχή | Διαδρομή | Τι κάνει |
|---------|----------|----------|
| Dashboard | `/` | KPIs & ουρά εργασίας |
| Πελάτες | `/customers` | Master data, χάρτης, καρτέλα |
| CRM | `/crm` | Leads & activities |
| Προσφορές / Παραγγελίες / Τιμολόγια | `/quotes` `/orders` `/invoices` | Κύκλος πωλήσεων + myDATA ουρά |
| Αποθήκη | `/inventory` | Υπόλοιπα, κινήσεις, WMS-lite |
| Αγορές | `/purchasing` | PO & παραλαβές |
| Οικονομικά | `/finance` | FI hub με καθολικά φίλτρα |
| HR | `/hr` | Ελληνικό HR hub |
| POS / Gift / Loyalty | `/pos` … | Λιανική |
| Integrations | `/settings/integrations` | Webhooks, myDATA, API |
| Docs | `/docs` | Αυτός ο οδηγός in-app |

## Ροές κλειδιά

### Έκδοση τιμολογίου → myDATA
1. Οργανισμός με ΑΦΜ στις Ρυθμίσεις  
2. Σειρά παραστατικού με myDATA ON + τύπο  
3. Έκδοση τιμολογίου  
4. Ουρά στο Finance → επεξεργασία (simulator ή live AADE)

### Μηνιαίο κλείσιμο FI
1. Φίλτρα μήνα στο `/finance`  
2. Post πρόχειρων άρθρων  
3. Ισοζύγιο / αποτελέσματα  
4. AR/AP + ΦΠΑ + myDATA  
5. Κλείσιμο περιόδου

### HR μήνας
1. Νέοι εργαζόμενοι / αποχωρήσεις → Εργάνη ουρά  
2. Άδειες & υπόλοιπα  
3. Κάρτα εργασίας / χτυπήματα  
4. Μισθοδοσία από `baseGross` → διόρθωση γραμμών → κλείσιμο

## Τεχνική βάση

- Next.js App Router + TypeScript  
- PostgreSQL + Prisma  
- Cookie JWT sessions (`jose`)  
- Softify UI (slate / teal / ink)  
- ADR στο `docs/adr/`

Demo: `maria@akropolis.gr` / `SoftifyOS!2026`
