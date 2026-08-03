# SoftifyOS — Roadmap go-live ελληνικής SME

Στόχος: από **ισχυρό θεμέλιο** → **παραγωγικό ERP** για τυπική ελληνική SME  
(εμπόριο / υπηρεσίες / λιανική χωρίς βαριά παραγωγή).

Δεν στοχεύουμε Softone-parity σε όλα. Στοχεύουμε **κλειστό κύκλο συμμόρφωσης + καθημερινή λειτουργία**.

---

## Αρχή προτεραιότητας

1. **Νόμιμο / υποχρεωτικό** πριν το «ωραίο»
2. **Κύκλος μετρητών** (παραστατικό → είσπραξη → τράπεζα → GL) πριν το CRM depth
3. **Λιανική ΦΗΜ** μόνο αν υπάρχει retail go-live
4. **Παραγωγή / project costing** μετά — δεν μπλοκάρει εμπορική SME

---

## Phase A — Συμμόρφωση & κλείσιμο μετρητών (πρώτα)

| # | Παραδοτέο | Γιατί | Ορισμός «έτοιμο» |
|---|-----------|-------|------------------|
| A1 | **myDATA production path** | Χωρίς αυτό δεν βγαίνει τιμολόγιο νόμιμα | Real credentials, retry/error UI, cancel, retail 11.x, purchase XML, monitoring ουράς |
| A2 | **Πάροχος e-invoicing (1)** | Πολλές SME θέλουν πάροχο, όχι μόνο ERP API | Adapter + sandbox + παραγωγή για έναν πάροχο (π.χ. Novaon/Impact) |
| A3 | **Settlements hardening** | Ήδη δυνατό — πρέπει να είναι bulletproof | Partial/multi-tender, void, GL auto, series policies, audit traces |
| A4 | **Banking recon depth** | Κλείσιμο ταμείου/τραπεζών | OFX/CSV → suggest → match AR/AP → unmatch, ανά LegalEntity |
| A5 | **Greek books pack** | Λογιστής / χρήση | Βιβλία εσόδων-εξόδων ή ισοζύγιο, ΦΠΑ περίοδος, AR/AP aging export |

**Outcome Phase A:** εμπορική SME μπορεί να τιμολογεί, εισπράττει, συμφωνεί τράπεζα, στέλνει myDATA.

---

## Phase B — Λιανική & πληρωμές (αν υπάρχει POS)

| # | Παραδοτέο | Γιατί | Ορισμός «έτοιμο» |
|---|-----------|-------|------------------|
| B1 | **Card provider live** (Viva/Worldline) | Soft POS σήμερα = MOCK | Πραγματικό auth/capture, voids, reconciliation |
| B2 | **ΦΗΜ / fiscal driver** | Ελληνική λιανική συμμόρφωση | Έκδοση ΑΠΥ μέσω εγκεκριμένης συσκευής/καναλιού |
| B3 | **POS day-end** | Ταμείο | Άνοιγμα/κλείσιμο βάρδιας, Z-report, cash variance |

**Outcome Phase B:** κατάστημα μπορεί να πουλάει νόμιμα στο ταμείο.

*Αν η SME είναι μόνο B2B χονδρική → Phase B μπορεί να περιμένει.*

---

## Phase C — HR / Εργάνη / μισθοδοσία lite

| # | Παραδοτέο | Γιατί | Ορισμός «έτοιμο» |
|---|-----------|-------|------------------|
| C1 | **Ergani live client** | Σήμερα stub/simulator | Υποβολή ωραρίου/κάρτας, status, σφάλματα |
| C2 | **Payroll v1** | Μισθοί | Περίοδοι, αποδοχές/κρατήσεις με πραγματικούς πίνακες (όχι μόνο %), export τράπεζας |
| C3 | **ΦΜΥ / ΑΠΔ export** | Υποχρεώσεις | Αρχεία ή API προς λογιστή/πάροχο |

**Outcome Phase C:** HR δεν είναι μόνο παρουσία — κλείνει μισθοδοτικό κύκλο.

---

## Phase D — Αποθήκη ops & αγορές

| # | Παραδοτέο | Γιατί | Ορισμός «έτοιμο» |
|---|-----------|-------|------------------|
| D1 | **3-way match** | PO ↔ παραλαβή ↔ τιμολόγιο προμηθευτή | Απόκλιση ποσοτήτων/τιμών, block πληρωμής |
| D2 | **Mobile picking / RF lite** | WMS στην πράξη | Pick list σε κινητό, confirm bins/lots |
| D3 | **Stock valuation & COGS close** | Οικονομικά σωστά | Περιοδικό κόστος, αναφορές αποθέματος αξίας |

---

## Phase E — FI βάθος & πάγια

| # | Παραδοτέο | Γιατί | Ορισμός «έτοιμο» |
|---|-----------|-------|------------------|
| E1 | **Period close checklist** | Μηνιαίο κλείσιμο | Lock περιόδων, ανοιχτά παραστατικά, ΦΠΑ, journals |
| E2 | **Fixed assets batch** | Πάγια | Μαζικές αποσβέσεις, διάθεση, tax vs book όπου χρειάζεται |
| E3 | **Consolidation polish** | Multi-company | Intercompany + αναφορές ομίλου |

---

## Phase F — Αργότερα (όχι για πρώτη SME)

- Παραγωγή / BOM / MRP  
- Project / job costing  
- Πλήρες CRM pipeline (πέρα από leads)  
- Live marketplace connectors (Skroutz κ.λπ.)  
- Offline PWA / service worker  
- Πλήρες RLS σε όλα τα tables  

---

## Προτεινόμενη σειρά υλοποίησης (sprint lens)

```
A1 myDATA prod     ─┐
A3 Settlements QA  ─┼─► A4 Banking ─► A5 Books ─► A2 Πάροχος
                    │
                    └─► (παράλληλα) docs + monitoring

αν retail: B1 → B3 → B2
αν μισθωτοί: C1 → C2 → C3
μετά: D1 → D2 / E1
```

---

## Τι θεωρούμε «SoftifyOS v1 go-live» για εμπορική SME

Πρέπει να ισχύουν **όλα**:

- [ ] myDATA παραγωγή (ή πιστοποιημένος πάροχος) χωρίς simulator  
- [ ] Πωλήσεις + εξοφλήσεις + ακυρώσεις σταθερά  
- [ ] Τραπεζική συμφωνία βασική  
- [ ] Βασικές ελληνικές αναφορές / ΦΠΑ περίοδος  
- [ ] Multi-company σωστό (σωστή Legal Entity παντού)  
- [ ] Backup, ρόλοι, audit  

Προαιρετικά ανά κλάδο:

- [ ] Retail → ΦΗΜ + card live + day-end  
- [ ] Με προσωπικό → Ergani live + payroll v1  

---

## Τρέχουσα θέση (Aug 2026)

| Περιοχή | Κατάσταση |
|---------|-----------|
| Sales / settlements / series / print | Δυνατό core |
| myDATA | Ουρά + XML — χρειάζεται prod hardening |
| Banking | Match υπάρχει — βάθος/λειτουργική σταθερότητα |
| POS | Soft POS — MOCK providers, όχι ΦΗΜ |
| HR | Ops UI — Ergani/payroll stub |
| WMS | Lite — όχι RF |
| Platform | Πολύ δυνατό για το στάδιο |

**Σύνοψη:** SoftifyOS είναι **foundation**. Το Phase A είναι το επόμενο κρίσιμο άλμα προς πραγματικό go-live.
