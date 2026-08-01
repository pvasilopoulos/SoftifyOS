export type MergeFieldGroup = {
  title: string;
  fields: Array<{ token: string; label: string; sample?: string }>;
};

export const PRINT_MERGE_FIELDS: MergeFieldGroup[] = [
  {
    title: "Εταιρεία",
    fields: [
      { token: "{{tenant.name}}", label: "Επωνυμία", sample: "Ακρόπολις ΑΕ" },
      { token: "{{tenant.code}}", label: "Κωδικός tenant" },
      { token: "{{company.vatNumber}}", label: "ΑΦΜ εταιρείας" },
      { token: "{{company.address}}", label: "Διεύθυνση" },
      { token: "{{company.phone}}", label: "Τηλέφωνο εταιρείας" },
      { token: "{{company.email}}", label: "Email εταιρείας" },
      { token: "{{company.bankName}}", label: "Τράπεζα" },
      { token: "{{company.iban}}", label: "IBAN" },
      { token: "{{company.bic}}", label: "BIC" },
    ],
  },
  {
    title: "Παραστατικό",
    fields: [
      { token: "{{doc.number}}", label: "Αριθμός", sample: "ΤΙΜ-2026-00012" },
      { token: "{{doc.status}}", label: "Κατάσταση" },
      { token: "{{doc.kindLabel}}", label: "Τύπος ετικέτα" },
      { token: "{{doc.issuedAt|date}}", label: "Ημ/νία έκδοσης" },
      { token: "{{doc.dueAt|date}}", label: "Ημ/νία λήξης" },
      { token: "{{doc.currency}}", label: "Νόμισμα" },
      { token: "{{doc.notes}}", label: "Σημειώσεις" },
      { token: "{{form.name}}", label: "Όνομα φόρμας" },
      { token: "{{payment.terms}}", label: "Όροι πληρωμής" },
      { token: "{{shipping.address}}", label: "Διεύθυνση αποστολής" },
    ],
  },
  {
    title: "Πελάτης",
    fields: [
      { token: "{{customer.name}}", label: "Επωνυμία" },
      { token: "{{customer.code}}", label: "Κωδικός" },
      { token: "{{customer.vatNumber}}", label: "ΑΦΜ" },
      { token: "{{customer.email}}", label: "Email" },
      { token: "{{customer.phone}}", label: "Τηλέφωνο" },
      { token: "{{branch.name}}", label: "Υποκατάστημα" },
      { token: "{{space.name}}", label: "Χώρος" },
    ],
  },
  {
    title: "Γραμμές (loop)",
    fields: [
      {
        token:
          "{{#each lines}}\n<tr>\n  <td>{{@number}}</td>\n  <td>{{this.description}}</td>\n  <td class=\"num\">{{this.quantity|number}}</td>\n  <td class=\"num\">{{this.unitPrice|eur}}</td>\n  <td class=\"num\">{{this.vatRate|number}}%</td>\n  <td class=\"num\">{{this.lineTotal|eur}}</td>\n</tr>\n{{/each}}",
        label: "Πίνακας γραμμών",
      },
      { token: "{{this.description}}", label: "Περιγραφή γραμμής" },
      { token: "{{this.quantity|number}}", label: "Ποσότητα" },
      { token: "{{this.unitPrice|eur}}", label: "Τιμή" },
      { token: "{{this.vatRate|number}}", label: "ΦΠΑ %" },
      { token: "{{this.net|eur}}", label: "Καθαρή γραμμής" },
      { token: "{{this.lineTotal|eur}}", label: "Σύνολο γραμμής" },
      { token: "{{@number}}", label: "Α/Α γραμμής" },
    ],
  },
  {
    title: "Ανάλυση ΦΠΑ",
    fields: [
      {
        token:
          "{{#each vatBreakdown}}\n<tr>\n  <td>{{this.rate|number}}%</td>\n  <td class=\"num\">{{this.base|eur}}</td>\n  <td class=\"num\">{{this.vat|eur}}</td>\n  <td class=\"num\">{{this.gross|eur}}</td>\n</tr>\n{{/each}}",
        label: "Πίνακας ΦΠΑ",
      },
      { token: "{{this.rate|number}}", label: "Συντελεστής" },
      { token: "{{this.base|eur}}", label: "Βάση" },
      { token: "{{this.vat|eur}}", label: "ΦΠΑ ποσό" },
      { token: "{{this.gross|eur}}", label: "Μικτό" },
    ],
  },
  {
    title: "Σύνολα",
    fields: [
      { token: "{{totals.subtotal|eur}}", label: "Καθαρή αξία" },
      { token: "{{totals.vatAmount|eur}}", label: "ΦΠΑ" },
      { token: "{{totals.total|eur}}", label: "Σύνολο" },
      { token: "{{totals.paid|eur}}", label: "Εξοφλημένα" },
      { token: "{{totals.balance|eur}}", label: "Υπόλοιπο" },
    ],
  },
  {
    title: "Συνθήκες",
    fields: [
      {
        token: "{{#if doc.notes}}\n<p>{{doc.notes}}</p>\n{{/if}}",
        label: "Αν υπάρχουν σημειώσεις",
      },
      {
        token: "{{#unless customer.vatNumber}}\n<span>Χωρίς ΑΦΜ</span>\n{{/unless}}",
        label: "Αν λείπει ΑΦΜ",
      },
    ],
  },
];

export const DEFAULT_INVOICE_HTML = `<div class="sheet">
  <header class="hdr">
    <div>
      <div class="brand">SoftifyOS</div>
      <h1>{{tenant.name}}</h1>
      <p class="muted">{{form.name}}</p>
    </div>
    <div class="right">
      <div class="docno">{{doc.number}}</div>
      <div class="muted">{{doc.status}} · {{doc.kindLabel}}</div>
    </div>
  </header>

  <section class="grid2">
    <div>
      <div class="label">Πελάτης</div>
      <div class="strong">{{customer.name}}</div>
      <div class="muted">{{customer.code}}</div>
      {{#if customer.vatNumber}}<div class="muted">ΑΦΜ {{customer.vatNumber}}</div>{{/if}}
      {{#if branch.name}}<div class="muted">{{branch.name}}</div>{{/if}}
      {{#if space.name}}<div class="muted">{{space.name}}</div>{{/if}}
    </div>
    <div class="meta">
      <div><span>Έκδοση</span><b>{{doc.issuedAt|date}}</b></div>
      <div><span>Λήξη</span><b>{{doc.dueAt|date}}</b></div>
      <div><span>Νόμισμα</span><b>{{doc.currency}}</b></div>
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

  <section class="totals">
    <div><span>Καθαρή αξία</span><b>{{totals.subtotal|eur}}</b></div>
    <div><span>ΦΠΑ</span><b>{{totals.vatAmount|eur}}</b></div>
    <div class="grand"><span>Σύνολο</span><b>{{totals.total|eur}}</b></div>
    <div><span>Εξοφλημένα</span><b>{{totals.paid|eur}}</b></div>
    <div><span>Υπόλοιπο</span><b>{{totals.balance|eur}}</b></div>
  </section>

  {{#if doc.notes}}
  <p class="notes"><strong>Σημειώσεις:</strong> {{doc.notes}}</p>
  {{/if}}

  <footer class="ftr">Ευχαριστούμε για τη συνεργασία · SoftifyOS</footer>
</div>`;

export const DEFAULT_INVOICE_CSS = `.sheet { max-width: 780px; margin: 0 auto; padding: 8px 4px; }
.hdr { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #0f766e; padding-bottom: 16px; margin-bottom: 20px; }
.brand { font-size: 10px; letter-spacing: .18em; text-transform: uppercase; color: #0f766e; font-weight: 700; }
.hdr h1 { margin: 6px 0 4px; font-size: 22px; }
.muted { color: #64748b; font-size: 12px; }
.right { text-align: right; }
.docno { font-size: 20px; font-weight: 700; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 22px; }
.label { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #94a3b8; font-weight: 700; margin-bottom: 4px; }
.strong { font-weight: 600; font-size: 14px; }
.meta > div { display: flex; justify-content: space-between; gap: 16px; padding: 3px 0; font-size: 12px; }
.meta span { color: #94a3b8; }
.lines { width: 100%; border-collapse: collapse; margin: 8px 0 18px; }
.lines th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #94a3b8; border-bottom: 1px solid #e2e8f0; padding: 8px 6px; }
.lines td { border-bottom: 1px solid #f1f5f9; padding: 10px 6px; vertical-align: top; }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.totals { margin-left: auto; width: 240px; }
.totals > div { display: flex; justify-content: space-between; padding: 4px 0; color: #475569; }
.totals .grand { border-top: 1px solid #cbd5e1; margin-top: 6px; padding-top: 8px; font-size: 14px; color: #0f172a; }
.notes { margin-top: 22px; color: #64748b; }
.ftr { margin-top: 28px; padding-top: 12px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 11px; }
@media print { .sheet { max-width: none; } }`;

export const DEFAULT_RECEIPT_HTML = `<div class="receipt">
  <div class="c">{{tenant.name}}</div>
  <div class="c muted">{{form.name}}</div>
  <div class="c strong">{{doc.number}}</div>
  <div class="c muted">{{doc.issuedAt|date}}</div>
  <hr/>
  <table>
{{#each lines}}
    <tr>
      <td>{{this.description}}</td>
      <td class="num">{{this.lineTotal|eur}}</td>
    </tr>
{{/each}}
  </table>
  <hr/>
  <div class="row"><span>Σύνολο</span><b>{{totals.total|eur}}</b></div>
  <div class="c muted ftr">Απόδειξη λιανικής</div>
</div>`;

export const DEFAULT_RECEIPT_CSS = `.receipt { width: 280px; margin: 0 auto; font-size: 12px; }
.c { text-align: center; }
.strong { font-weight: 700; font-size: 14px; margin: 6px 0; }
.muted { color: #64748b; }
hr { border: none; border-top: 1px dashed #cbd5e1; margin: 10px 0; }
table { width: 100%; border-collapse: collapse; }
td { padding: 4px 0; vertical-align: top; }
.num { text-align: right; white-space: nowrap; }
.row { display: flex; justify-content: space-between; font-size: 14px; margin-top: 6px; }
.ftr { margin-top: 14px; font-size: 10px; }`;

export const SAMPLE_PRINT_CONTEXT: Record<string, unknown> = {
  tenant: { name: "Ακρόπολις ΑΕ", code: "akropolis" },
  company: {
    vatNumber: "999888777",
    address: "Λεωφ. Συγγρού 100, Αθήνα 11745",
    phone: "210-900-1000",
    email: "billing@akropolis.gr",
    bankName: "Εθνική Τράπεζα",
    iban: "GR16 0110 1250 0000 1254 0123 456",
    bic: "ETHNGRAA",
  },
  payment: { terms: "Καθαρό 30 ημέρες" },
  shipping: { address: "Αποθήκη Ασπροπύργου, Οδός Βιομηχανίας 12" },
  form: { name: "Τιμολόγιο — HTML φόρμα" },
  doc: {
    number: "ΤΙΜ-2026-00042",
    status: "Εκδομένο",
    kindLabel: "Τιμολόγιο πώλησης",
    issuedAt: "2026-07-30",
    dueAt: "2026-08-30",
    currency: "EUR",
    notes: "Παράδοση εντός 2 εργάσιμων.",
  },
  customer: {
    name: "Νηρέας Logistics ΟΕ",
    code: "C-1042",
    vatNumber: "998877665",
    email: "ap@nireas.gr",
    phone: "2101234567",
  },
  branch: { name: "Κεντρικό" },
  space: { name: "Γραφεία" },
  lines: [
    {
      description: "Υπηρεσίες συμβουλευτικής",
      quantity: 1,
      unitPrice: 800,
      vatRate: 24,
      net: 800,
      lineTotal: 992,
    },
    {
      description: "Άδεια SoftifyOS · μήνας",
      quantity: 3,
      unitPrice: 49,
      vatRate: 24,
      net: 147,
      lineTotal: 182.28,
    },
    {
      description: "Εκπαιδευτικό υλικό",
      quantity: 2,
      unitPrice: 20,
      vatRate: 13,
      net: 40,
      lineTotal: 45.2,
    },
  ],
  vatBreakdown: [
    { rate: 24, base: 947, vat: 227.28, gross: 1174.28 },
    { rate: 13, base: 40, vat: 5.2, gross: 45.2 },
  ],
  totals: {
    subtotal: 987,
    vatAmount: 232.48,
    total: 1219.48,
    paid: 0,
    balance: 1219.48,
  },
};
