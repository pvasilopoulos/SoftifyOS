import type { PrintFormBodyV2 } from "./defaults";
import { DEFAULT_PAGE_SETTINGS } from "./page-geometry";

/** Professional corporate invoice with bank box + signatures */
export const ADVANCED_INVOICE_PRO_HTML = `<div class="pro">
  <div class="accent"></div>
  <header class="hdr">
    <div>
      <div class="brand">{{tenant.name}}</div>
      <div class="muted">{{company.address}}</div>
      <div class="muted">ΑΦΜ {{company.vatNumber}} · Τηλ. {{company.phone}}</div>
      <div class="muted">{{company.email}}</div>
    </div>
    <div class="badge">
      <div class="kind">{{doc.kindLabel}}</div>
      <div class="docno">{{doc.number}}</div>
      <div class="muted">{{doc.issuedAt|date}}</div>
    </div>
  </header>

  <section class="grid3">
    <div class="card">
      <div class="label">Πελάτης</div>
      <div class="strong">{{customer.name}}</div>
      <div class="muted">{{customer.code}}</div>
      {{#if customer.vatNumber}}<div class="muted">ΑΦΜ {{customer.vatNumber}}</div>{{/if}}
      {{#if customer.email}}<div class="muted">{{customer.email}}</div>{{/if}}
      {{#if branch.name}}<div class="muted">{{branch.name}}</div>{{/if}}
    </div>
    <div class="card">
      <div class="label">Παραστατικό</div>
      <div class="row"><span>Κατάσταση</span><b>{{doc.status}}</b></div>
      <div class="row"><span>Λήξη</span><b>{{doc.dueAt|date}}</b></div>
      <div class="row"><span>Νόμισμα</span><b>{{doc.currency}}</b></div>
      <div class="row"><span>Όροι</span><b>{{payment.terms}}</b></div>
    </div>
    <div class="card bank">
      <div class="label">Πληρωμή</div>
      <div class="row"><span>Τράπεζα</span><b>{{company.bankName}}</b></div>
      <div class="row"><span>IBAN</span><b class="iban">{{company.iban}}</b></div>
      <div class="row"><span>BIC</span><b>{{company.bic}}</b></div>
      <div class="hint">Αναφέρετε τον αριθμό {{doc.number}}</div>
    </div>
  </section>

  <table class="lines">
    <thead>
      <tr>
        <th>#</th>
        <th>Περιγραφή</th>
        <th class="num">Ποσ.</th>
        <th class="num">Τιμή</th>
        <th class="num">ΦΠΑ</th>
        <th class="num">Σύνολο</th>
      </tr>
    </thead>
    <tbody>
{{#each lines}}
      <tr>
        <td>{{@number}}</td>
        <td>{{this.description}}</td>
        <td class="num">{{this.quantity|number}}</td>
        <td class="num">{{this.unitPrice|eur}}</td>
        <td class="num">{{this.vatRate|number}}%</td>
        <td class="num">{{this.lineTotal|eur}}</td>
      </tr>
{{/each}}
    </tbody>
  </table>

  <section class="bottom">
    <div class="notes-col">
      {{#if doc.notes}}
      <div class="label">Σημειώσεις</div>
      <p>{{doc.notes}}</p>
      {{/if}}
      {{#if shipping.address}}
      <div class="label">Διεύθυνση αποστολής</div>
      <p>{{shipping.address}}</p>
      {{/if}}
      <div class="sigs">
        <div><span>Για την εταιρεία</span></div>
        <div><span>Παραλαβή</span></div>
      </div>
    </div>
    <div class="totals">
      <div><span>Καθαρή αξία</span><b>{{totals.subtotal|eur}}</b></div>
      <div><span>ΦΠΑ</span><b>{{totals.vatAmount|eur}}</b></div>
      <div class="grand"><span>Πληρωτέο</span><b>{{totals.total|eur}}</b></div>
      <div><span>Εξοφλημένα</span><b>{{totals.paid|eur}}</b></div>
      <div class="due"><span>Υπόλοιπο</span><b>{{totals.balance|eur}}</b></div>
    </div>
  </section>
  <footer class="ftr">{{form.name}} · SoftifyOS Print Engine</footer>
</div>`;

export const ADVANCED_INVOICE_PRO_CSS = `.pro { position: relative; padding: 8px 4px 4px; font-size: 12px; color: #0f172a; }
.accent { position: absolute; left: 0; top: 0; bottom: 0; width: 5px; background: linear-gradient(180deg,#0f766e,#115e59); border-radius: 3px; }
.hdr { display: flex; justify-content: space-between; gap: 20px; margin: 0 0 18px 10px; }
.brand { font-size: 20px; font-weight: 700; letter-spacing: -0.02em; }
.muted { color: #64748b; font-size: 11px; line-height: 1.45; }
.badge { text-align: right; min-width: 180px; }
.kind { font-size: 10px; text-transform: uppercase; letter-spacing: .12em; color: #0f766e; font-weight: 700; }
.docno { font-size: 22px; font-weight: 700; margin: 4px 0; }
.grid3 { display: grid; grid-template-columns: 1.2fr 1fr 1.1fr; gap: 12px; margin: 0 0 18px 10px; }
.card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; background: #f8fafc; }
.card.bank { background: #f0fdfa; border-color: #99f6e4; }
.label { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #94a3b8; font-weight: 700; margin-bottom: 6px; }
.strong { font-weight: 650; font-size: 13px; }
.row { display: flex; justify-content: space-between; gap: 10px; padding: 2px 0; }
.iban { font-family: ui-monospace, monospace; font-size: 11px; }
.hint { margin-top: 8px; font-size: 10px; color: #0f766e; }
.lines { width: calc(100% - 10px); margin-left: 10px; border-collapse: collapse; }
.lines th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #64748b; border-bottom: 2px solid #0f766e; padding: 8px 6px; }
.lines td { border-bottom: 1px solid #e2e8f0; padding: 9px 6px; }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.bottom { display: grid; grid-template-columns: 1.4fr 240px; gap: 18px; margin: 16px 0 0 10px; }
.notes-col p { margin: 0 0 10px; color: #475569; }
.sigs { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 28px; }
.sigs > div { border-top: 1px solid #cbd5e1; padding-top: 8px; min-height: 48px; color: #94a3b8; font-size: 11px; }
.totals > div { display: flex; justify-content: space-between; padding: 4px 0; color: #475569; }
.totals .grand { border-top: 1px solid #cbd5e1; margin-top: 6px; padding-top: 8px; font-size: 14px; color: #0f172a; }
.totals .due { color: #0f766e; font-weight: 600; }
.ftr { margin: 22px 0 0 10px; color: #94a3b8; font-size: 10px; }
@media print { .pro { padding: 0; } }`;

/** Bilingual EL / EN invoice */
export const ADVANCED_INVOICE_BILINGUAL_HTML = `<div class="bi">
  <header class="hdr">
    <div>
      <h1>{{tenant.name}}</h1>
      <p class="muted">{{company.address}} · VAT {{company.vatNumber}}</p>
    </div>
    <div class="right">
      <div class="title">ΤΙΜΟΛΟΓΙΟ / INVOICE</div>
      <div class="docno">{{doc.number}}</div>
      <div class="muted">{{doc.issuedAt|date}}</div>
    </div>
  </header>
  <section class="grid2">
    <div>
      <div class="label">Πελάτης / Customer</div>
      <div class="strong">{{customer.name}}</div>
      <div class="muted">{{customer.code}} · ΑΦΜ/VAT {{customer.vatNumber}}</div>
    </div>
    <div class="meta">
      <div><span>Έκδοση / Issue</span><b>{{doc.issuedAt|date}}</b></div>
      <div><span>Λήξη / Due</span><b>{{doc.dueAt|date}}</b></div>
      <div><span>Νόμισμα / Currency</span><b>{{doc.currency}}</b></div>
    </div>
  </section>
  <table class="lines">
    <thead>
      <tr>
        <th>#</th>
        <th>Περιγραφή / Description</th>
        <th class="num">Qty</th>
        <th class="num">Price</th>
        <th class="num">VAT</th>
        <th class="num">Total</th>
      </tr>
    </thead>
    <tbody>
{{#each lines}}
      <tr>
        <td>{{@number}}</td>
        <td>{{this.description}}</td>
        <td class="num">{{this.quantity|number}}</td>
        <td class="num">{{this.unitPrice|eur}}</td>
        <td class="num">{{this.vatRate|number}}%</td>
        <td class="num">{{this.lineTotal|eur}}</td>
      </tr>
{{/each}}
    </tbody>
  </table>
  <section class="totals">
    <div><span>Καθαρή / Net</span><b>{{totals.subtotal|eur}}</b></div>
    <div><span>ΦΠΑ / VAT</span><b>{{totals.vatAmount|eur}}</b></div>
    <div class="grand"><span>Σύνολο / Total</span><b>{{totals.total|eur}}</b></div>
  </section>
  <p class="ftr">IBAN {{company.iban}} · Please quote {{doc.number}}</p>
</div>`;

export const ADVANCED_INVOICE_BILINGUAL_CSS = `.bi { font-size: 12px; }
.hdr { display:flex; justify-content:space-between; gap:20px; border-bottom:3px double #0f172a; padding-bottom:14px; margin-bottom:18px; }
.hdr h1 { margin:0; font-size:20px; }
.title { font-size:11px; letter-spacing:.14em; font-weight:700; }
.docno { font-size:20px; font-weight:700; }
.right { text-align:right; }
.muted { color:#64748b; font-size:11px; }
.grid2 { display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:18px; }
.label { font-size:10px; text-transform:uppercase; letter-spacing:.08em; color:#94a3b8; font-weight:700; }
.strong { font-weight:650; }
.meta > div { display:flex; justify-content:space-between; padding:3px 0; }
.meta span { color:#94a3b8; }
.lines { width:100%; border-collapse:collapse; margin-bottom:16px; }
.lines th { text-align:left; font-size:10px; text-transform:uppercase; color:#64748b; border-bottom:1px solid #0f172a; padding:8px 5px; }
.lines td { border-bottom:1px solid #e2e8f0; padding:8px 5px; }
.num { text-align:right; font-variant-numeric:tabular-nums; }
.totals { margin-left:auto; width:260px; }
.totals > div { display:flex; justify-content:space-between; padding:3px 0; }
.totals .grand { border-top:1px solid #0f172a; margin-top:6px; padding-top:8px; font-size:14px; }
.ftr { margin-top:20px; color:#64748b; font-size:11px; }`;

/** Invoice with VAT rate breakdown */
export const ADVANCED_INVOICE_VAT_HTML = `<div class="vat">
  <header class="hdr">
    <div>
      <div class="brand">{{tenant.name}}</div>
      <div class="muted">Ανάλυση ΦΠΑ ανά συντελεστή</div>
    </div>
    <div class="right">
      <div class="docno">{{doc.number}}</div>
      <div class="muted">{{doc.issuedAt|date}} · {{doc.kindLabel}}</div>
    </div>
  </header>
  <section class="parties">
    <div><span class="label">Πελάτης</span><div class="strong">{{customer.name}}</div><div class="muted">ΑΦΜ {{customer.vatNumber}}</div></div>
    <div><span class="label">Υπόλοιπο</span><div class="due">{{totals.balance|eur}}</div></div>
  </section>
  <table class="lines">
    <thead><tr><th>#</th><th>Περιγραφή</th><th class="num">Ποσ.</th><th class="num">Καθαρή</th><th class="num">ΦΠΑ %</th><th class="num">Σύνολο</th></tr></thead>
    <tbody>
{{#each lines}}
      <tr>
        <td>{{@number}}</td>
        <td>{{this.description}}</td>
        <td class="num">{{this.quantity|number}}</td>
        <td class="num">{{this.net|eur}}</td>
        <td class="num">{{this.vatRate|number}}%</td>
        <td class="num">{{this.lineTotal|eur}}</td>
      </tr>
{{/each}}
    </tbody>
  </table>
  <h3 class="sec">Ανάλυση ΦΠΑ</h3>
  <table class="vat-table">
    <thead><tr><th>Συντελεστής</th><th class="num">Βάση</th><th class="num">ΦΠΑ</th><th class="num">Σύνολο</th></tr></thead>
    <tbody>
{{#each vatBreakdown}}
      <tr>
        <td>{{this.rate|number}}%</td>
        <td class="num">{{this.base|eur}}</td>
        <td class="num">{{this.vat|eur}}</td>
        <td class="num">{{this.gross|eur}}</td>
      </tr>
{{/each}}
    </tbody>
  </table>
  <section class="totals">
    <div><span>Καθαρή αξία</span><b>{{totals.subtotal|eur}}</b></div>
    <div><span>Σύνολο ΦΠΑ</span><b>{{totals.vatAmount|eur}}</b></div>
    <div class="grand"><span>Γενικό σύνολο</span><b>{{totals.total|eur}}</b></div>
  </section>
</div>`;

export const ADVANCED_INVOICE_VAT_CSS = `.vat { font-size:12px; }
.hdr { display:flex; justify-content:space-between; margin-bottom:16px; padding-bottom:12px; border-bottom:2px solid #0369a1; }
.brand { font-size:18px; font-weight:700; color:#0c4a6e; }
.muted { color:#64748b; font-size:11px; }
.right { text-align:right; }
.docno { font-size:20px; font-weight:700; }
.parties { display:flex; justify-content:space-between; gap:20px; margin-bottom:16px; }
.label { display:block; font-size:10px; text-transform:uppercase; color:#94a3b8; font-weight:700; }
.strong { font-weight:650; }
.due { font-size:22px; font-weight:700; color:#0369a1; }
.lines, .vat-table { width:100%; border-collapse:collapse; margin-bottom:14px; }
.lines th, .vat-table th { text-align:left; font-size:10px; text-transform:uppercase; color:#64748b; border-bottom:1px solid #bae6fd; padding:7px 5px; }
.lines td, .vat-table td { border-bottom:1px solid #f1f5f9; padding:8px 5px; }
.vat-table { background:#f0f9ff; border-radius:8px; }
.num { text-align:right; font-variant-numeric:tabular-nums; }
.sec { font-size:12px; margin:8px 0; color:#0c4a6e; }
.totals { margin-left:auto; width:240px; }
.totals > div { display:flex; justify-content:space-between; padding:3px 0; }
.totals .grand { border-top:1px solid #0369a1; margin-top:6px; padding-top:8px; font-size:14px; }`;

/** Quote / Proforma */
export const ADVANCED_QUOTE_HTML = `<div class="quo">
  <header class="hdr">
    <div>
      <div class="tag">ΠΡΟΣΦΟΡΑ / PROFORMA</div>
      <h1>{{tenant.name}}</h1>
      <p class="muted">Ισχύει έως {{doc.dueAt|date}} · {{payment.terms}}</p>
    </div>
    <div class="right">
      <div class="docno">{{doc.number}}</div>
      <div class="muted">{{doc.issuedAt|date}}</div>
    </div>
  </header>
  <section class="grid2">
    <div>
      <div class="label">Προς</div>
      <div class="strong">{{customer.name}}</div>
      <div class="muted">{{customer.email}} · {{customer.phone}}</div>
    </div>
    <div class="meta">
      <div><span>Κατάσταση</span><b>{{doc.status}}</b></div>
      <div><span>Νόμισμα</span><b>{{doc.currency}}</b></div>
    </div>
  </section>
  <table class="lines">
    <thead><tr><th>#</th><th>Περιγραφή</th><th class="num">Ποσ.</th><th class="num">Τιμή</th><th class="num">Σύνολο</th></tr></thead>
    <tbody>
{{#each lines}}
      <tr>
        <td>{{@number}}</td>
        <td>{{this.description}}</td>
        <td class="num">{{this.quantity|number}}</td>
        <td class="num">{{this.unitPrice|eur}}</td>
        <td class="num">{{this.lineTotal|eur}}</td>
      </tr>
{{/each}}
    </tbody>
  </table>
  <section class="totals">
    <div><span>Καθαρή</span><b>{{totals.subtotal|eur}}</b></div>
    <div><span>ΦΠΑ</span><b>{{totals.vatAmount|eur}}</b></div>
    <div class="grand"><span>Σύνολο προσφοράς</span><b>{{totals.total|eur}}</b></div>
  </section>
  {{#if doc.notes}}<p class="notes"><strong>Όροι:</strong> {{doc.notes}}</p>{{/if}}
  <p class="ftr">Η προσφορά δεν αποτελεί φορολογικό παραστατικό. Μετατρέψτε σε παραγγελία για δέσμευση.</p>
</div>`;

export const ADVANCED_QUOTE_CSS = `.quo { font-size:12px; }
.hdr { display:flex; justify-content:space-between; margin-bottom:18px; padding-bottom:14px; border-bottom:2px solid #b45309; }
.tag { display:inline-block; background:#fffbeb; color:#b45309; border:1px solid #fcd34d; border-radius:999px; padding:2px 10px; font-size:10px; font-weight:700; letter-spacing:.08em; }
.hdr h1 { margin:8px 0 4px; font-size:20px; }
.muted { color:#64748b; font-size:11px; }
.right { text-align:right; }
.docno { font-size:20px; font-weight:700; color:#92400e; }
.grid2 { display:grid; grid-template-columns:1fr 1fr; gap:18px; margin-bottom:16px; }
.label { font-size:10px; text-transform:uppercase; color:#94a3b8; font-weight:700; }
.strong { font-weight:650; }
.meta > div { display:flex; justify-content:space-between; padding:3px 0; }
.meta span { color:#94a3b8; }
.lines { width:100%; border-collapse:collapse; margin-bottom:14px; }
.lines th { text-align:left; font-size:10px; text-transform:uppercase; color:#92400e; border-bottom:1px solid #fcd34d; padding:8px 5px; }
.lines td { border-bottom:1px solid #fef3c7; padding:8px 5px; }
.num { text-align:right; font-variant-numeric:tabular-nums; }
.totals { margin-left:auto; width:240px; }
.totals > div { display:flex; justify-content:space-between; padding:3px 0; }
.totals .grand { border-top:1px solid #b45309; margin-top:6px; padding-top:8px; font-size:14px; }
.notes { margin-top:16px; color:#78716c; }
.ftr { margin-top:18px; font-size:10px; color:#a8a29e; }`;

/** Order confirmation */
export const ADVANCED_ORDER_HTML = `<div class="ord">
  <header class="hdr">
    <div>
      <div class="tag">ΕΠΙΒΕΒΑΙΩΣΗ ΠΑΡΑΓΓΕΛΙΑΣ</div>
      <h1>{{tenant.name}}</h1>
    </div>
    <div class="right">
      <div class="docno">{{doc.number}}</div>
      <div class="muted">{{doc.issuedAt|date}} · {{doc.status}}</div>
    </div>
  </header>
  <section class="grid2">
    <div>
      <div class="label">Πελάτης</div>
      <div class="strong">{{customer.name}}</div>
      <div class="muted">{{customer.code}} · {{customer.phone}}</div>
    </div>
    <div>
      <div class="label">Παράδοση</div>
      <div class="strong">{{shipping.address}}</div>
      <div class="muted">{{payment.terms}}</div>
    </div>
  </section>
  <table class="lines">
    <thead><tr><th>#</th><th>Είδος</th><th class="num">Ποσ.</th><th class="num">Τιμή</th><th class="num">Σύνολο</th></tr></thead>
    <tbody>
{{#each lines}}
      <tr>
        <td>{{@number}}</td>
        <td>{{this.description}}</td>
        <td class="num">{{this.quantity|number}}</td>
        <td class="num">{{this.unitPrice|eur}}</td>
        <td class="num">{{this.lineTotal|eur}}</td>
      </tr>
{{/each}}
    </tbody>
  </table>
  <section class="totals">
    <div><span>Καθαρή</span><b>{{totals.subtotal|eur}}</b></div>
    <div><span>ΦΠΑ</span><b>{{totals.vatAmount|eur}}</b></div>
    <div class="grand"><span>Σύνολο παραγγελίας</span><b>{{totals.total|eur}}</b></div>
  </section>
  {{#if doc.notes}}<p class="notes">{{doc.notes}}</p>{{/if}}
</div>`;

export const ADVANCED_ORDER_CSS = `.ord { font-size:12px; }
.hdr { display:flex; justify-content:space-between; margin-bottom:16px; padding-bottom:12px; border-bottom:2px solid #115e59; }
.tag { display:inline-block; background:#ccfbf1; color:#115e59; border-radius:6px; padding:3px 8px; font-size:10px; font-weight:700; }
.hdr h1 { margin:8px 0 0; font-size:18px; }
.muted { color:#64748b; font-size:11px; }
.right { text-align:right; }
.docno { font-size:20px; font-weight:700; }
.grid2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:14px; }
.label { font-size:10px; text-transform:uppercase; color:#94a3b8; font-weight:700; }
.strong { font-weight:650; }
.lines { width:100%; border-collapse:collapse; margin-bottom:14px; }
.lines th { text-align:left; font-size:10px; text-transform:uppercase; color:#115e59; border-bottom:1px solid #99f6e4; padding:8px 5px; }
.lines td { border-bottom:1px solid #f0fdfa; padding:8px 5px; }
.num { text-align:right; font-variant-numeric:tabular-nums; }
.totals { margin-left:auto; width:240px; }
.totals > div { display:flex; justify-content:space-between; padding:3px 0; }
.totals .grand { border-top:1px solid #115e59; margin-top:6px; padding-top:8px; font-size:14px; }
.notes { margin-top:14px; color:#475569; }`;

/** Delivery / packing list */
export const ADVANCED_DELIVERY_HTML = `<div class="dn">
  <header class="hdr">
    <div>
      <div class="tag">ΔΕΛΤΙΟ ΑΠΟΣΤΟΛΗΣ / PACKING LIST</div>
      <h1>{{tenant.name}}</h1>
      <p class="muted">{{company.phone}} · {{company.email}}</p>
    </div>
    <div class="right">
      <div class="docno">{{doc.number}}</div>
      <div class="muted">{{doc.issuedAt|date}}</div>
    </div>
  </header>
  <section class="grid2">
    <div class="box">
      <div class="label">Παραλήπτης</div>
      <div class="strong">{{customer.name}}</div>
      <div class="muted">{{shipping.address}}</div>
      <div class="muted">{{customer.phone}}</div>
    </div>
    <div class="box">
      <div class="label">Αποστολέας</div>
      <div class="strong">{{tenant.name}}</div>
      <div class="muted">{{company.address}}</div>
      <div class="muted">ΑΦΜ {{company.vatNumber}}</div>
    </div>
  </section>
  <table class="lines">
    <thead><tr><th>#</th><th>Περιγραφή</th><th class="num">Ποσότητα</th><th>✓</th></tr></thead>
    <tbody>
{{#each lines}}
      <tr>
        <td>{{@number}}</td>
        <td>{{this.description}}</td>
        <td class="num">{{this.quantity|number}}</td>
        <td class="check">□</td>
      </tr>
{{/each}}
    </tbody>
  </table>
  <section class="sigs">
    <div><span>Παρέδωσε</span></div>
    <div><span>Παρέλαβε</span></div>
    <div><span>Ημ/νία · ώρα</span></div>
  </section>
  {{#if doc.notes}}<p class="notes">{{doc.notes}}</p>{{/if}}
</div>`;

export const ADVANCED_DELIVERY_CSS = `.dn { font-size:12px; }
.hdr { display:flex; justify-content:space-between; margin-bottom:16px; padding-bottom:12px; border-bottom:2px solid #334155; }
.tag { display:inline-block; background:#f1f5f9; color:#334155; border-radius:6px; padding:3px 8px; font-size:10px; font-weight:700; letter-spacing:.06em; }
.hdr h1 { margin:8px 0 4px; font-size:18px; }
.muted { color:#64748b; font-size:11px; }
.right { text-align:right; }
.docno { font-size:20px; font-weight:700; }
.grid2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:14px; }
.box { border:1px dashed #cbd5e1; border-radius:10px; padding:12px; }
.label { font-size:10px; text-transform:uppercase; color:#94a3b8; font-weight:700; }
.strong { font-weight:650; margin:4px 0; }
.lines { width:100%; border-collapse:collapse; margin-bottom:20px; }
.lines th { text-align:left; font-size:10px; text-transform:uppercase; color:#475569; border-bottom:2px solid #334155; padding:8px 5px; }
.lines td { border-bottom:1px solid #e2e8f0; padding:10px 5px; }
.num { text-align:right; font-variant-numeric:tabular-nums; }
.check { text-align:center; font-size:16px; }
.sigs { display:grid; grid-template-columns:1fr 1fr 1fr; gap:16px; }
.sigs > div { border-top:1px solid #94a3b8; padding-top:8px; min-height:56px; color:#64748b; font-size:11px; }
.notes { margin-top:14px; color:#475569; }`;

/** Compact 58mm thermal receipt */
export const ADVANCED_RECEIPT_58_HTML = `<div class="r58">
  <div class="c brand">{{tenant.name}}</div>
  <div class="c muted">ΑΦΜ {{company.vatNumber}}</div>
  <div class="c muted">{{company.phone}}</div>
  <div class="line"></div>
  <div class="c strong">{{doc.number}}</div>
  <div class="c muted">{{doc.issuedAt|date}}</div>
  <div class="line"></div>
{{#each lines}}
  <div class="item">
    <div>{{this.description}}</div>
    <div class="row"><span>{{this.quantity|number}} × {{this.unitPrice|eur}}</span><b>{{this.lineTotal|eur}}</b></div>
  </div>
{{/each}}
  <div class="line"></div>
  <div class="row total"><span>ΣΥΝΟΛΟ</span><b>{{totals.total|eur}}</b></div>
  <div class="row"><span>ΦΠΑ</span><span>{{totals.vatAmount|eur}}</span></div>
  <div class="line"></div>
  <div class="c muted tiny">ΑΠΥ · SoftifyOS</div>
</div>`;

export const ADVANCED_RECEIPT_58_CSS = `.r58 { width: 220px; margin: 0 auto; font-size: 11px; font-family: ui-monospace, monospace; }
.c { text-align: center; }
.brand { font-weight: 700; font-size: 13px; }
.strong { font-weight: 700; font-size: 12px; margin: 4px 0; }
.muted { color: #475569; }
.tiny { font-size: 9px; margin-top: 8px; }
.line { border-top: 1px dashed #94a3b8; margin: 8px 0; }
.item { margin: 6px 0; }
.row { display: flex; justify-content: space-between; gap: 8px; }
.total { font-size: 13px; font-weight: 700; margin-top: 4px; }`;

export function bodyFromHtmlCss(
  html: string,
  css: string,
  page?: PrintFormBodyV2["page"],
): PrintFormBodyV2 {
  return {
    version: 2,
    engine: "html",
    html,
    css,
    page: page ?? { ...DEFAULT_PAGE_SETTINGS },
  };
}

export const ADVANCED_PRINT_PRESETS = [
  {
    id: "invoice_pro",
    label: "Invoice Pro",
    html: ADVANCED_INVOICE_PRO_HTML,
    css: ADVANCED_INVOICE_PRO_CSS,
  },
  {
    id: "invoice_bilingual",
    label: "Δίγλωσσο",
    html: ADVANCED_INVOICE_BILINGUAL_HTML,
    css: ADVANCED_INVOICE_BILINGUAL_CSS,
  },
  {
    id: "invoice_vat",
    label: "Ανάλυση ΦΠΑ",
    html: ADVANCED_INVOICE_VAT_HTML,
    css: ADVANCED_INVOICE_VAT_CSS,
  },
  {
    id: "quote",
    label: "Προσφορά",
    html: ADVANCED_QUOTE_HTML,
    css: ADVANCED_QUOTE_CSS,
  },
  {
    id: "order",
    label: "Παραγγελία",
    html: ADVANCED_ORDER_HTML,
    css: ADVANCED_ORDER_CSS,
  },
  {
    id: "delivery",
    label: "Δελτίο",
    html: ADVANCED_DELIVERY_HTML,
    css: ADVANCED_DELIVERY_CSS,
  },
  {
    id: "receipt58",
    label: "Thermal 58mm",
    html: ADVANCED_RECEIPT_58_HTML,
    css: ADVANCED_RECEIPT_58_CSS,
  },
] as const;
