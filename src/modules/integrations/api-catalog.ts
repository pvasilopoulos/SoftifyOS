export type ApiEndpointDoc = {
  key: string;
  path: string;
  method: string;
  title: string;
  desc: string;
  /** Ποιος μπορεί να καλέσει */
  auth: string;
  /** Roles / σημειώσεις πρόσβασης */
  access: string;
  /** Query / path params */
  params?: Array<{ name: string; required?: boolean; desc: string }>;
  /** Request body fields */
  body?: Array<{ name: string; required?: boolean; desc: string }>;
  /** Headers πέρα από Cookie/session */
  headers?: Array<{ name: string; desc: string }>;
  curl: string;
  responseExample: string;
  notes?: string[];
};

export const INTEGRATION_API_CATALOG: ApiEndpointDoc[] = [
  {
    key: "health",
    path: "/api/health",
    method: "GET",
    title: "Health check",
    desc: "Δημόσιος έλεγχος ότι η υπηρεσία SoftifyOS είναι πάνω. Χωρίς login.",
    auth: "Δημόσιο — δεν απαιτεί session ούτε API token",
    access: "Οποιοσδήποτε (public)",
    curl: `curl -sS https://YOUR_HOST/api/health`,
    responseExample: `{
  "ok": true,
  "service": "softifyos",
  "template": "v2",
  "time": "2026-08-01T21:00:00.000Z"
}`,
    notes: [
      "Χρήσιμο για load balancer / uptime monitors.",
      "Cache-Control: no-store.",
    ],
  },
  {
    key: "myDataQueue",
    path: "/api/mydata/submissions",
    method: "GET",
    title: "Ουρά myDATA submissions",
    desc: "Λίστα εγγραφών ουράς διαβίβασης παραστατικών προς ΑΑΔΕ (έως 100).",
    auth: "Session cookie (σύνδεση στο ERP) ή μελλοντικά Bearer API token",
    access: "Όλοι οι συνδεδεμένοι ρόλοι του tenant",
    params: [
      {
        name: "status",
        desc: "Προαιρετικό φίλτρο: PENDING | SENT | ACCEPTED | REJECTED | CANCELLED",
      },
    ],
    curl: `curl -sS 'https://YOUR_HOST/api/mydata/submissions?status=PENDING' \\
  -H 'Cookie: softify_session=...'`,
    responseExample: `{
  "items": [
    {
      "id": "clx…",
      "entityType": "invoice",
      "entityNumber": "ΤΔΑ-2026-00012",
      "invoiceType": "1.1",
      "status": "PENDING",
      "mark": null,
      "createdAt": "2026-08-01T10:15:00.000Z",
      "updatedAt": "2026-08-01T10:15:00.000Z",
      "lastAttemptAt": null
    }
  ]
}`,
    notes: [
      "Η ουρά γεμίζει όταν η σειρά παραστατικού έχει myDATA enabled.",
      "Για live αποστολή χρειάζονται credentials στο myDATA section.",
    ],
  },
  {
    key: "myDataProcess",
    path: "/api/mydata/submissions/process-batch",
    method: "POST",
    title: "Επεξεργασία ουράς myDATA",
    desc: "Επεξεργάζεται έως 25 εκκρεμείς εγγραφές (simulator / test / prod ανά ρυθμίσεις).",
    auth: "Session cookie",
    access: "Όλοι εκτός VIEWER",
    curl: `curl -sS -X POST https://YOUR_HOST/api/mydata/submissions/process-batch \\
  -H 'Cookie: softify_session=...' \\
  -H 'Content-Type: application/json'`,
    responseExample: `{
  "processed": 2,
  "items": [
    {
      "id": "clx…",
      "status": "ACCEPTED",
      "mark": "400001234567890",
      "entityNumber": "ΤΔΑ-2026-00012"
    }
  ]
}`,
    notes: [
      "Simulator: τοπικό MARK χωρίς κλήση ΑΑΔΕ.",
      "Test/Prod: πραγματικό SendInvoices όταν υπάρχουν aade-user-id + subscription key.",
    ],
  },
  {
    key: "scriptsUiEvent",
    path: "/api/scripts/ui-event",
    method: "POST",
    title: "Script Hooks / UI events",
    desc: "Τρέχει published UI/BOTH scripts για form events (onLoad, onFieldChange, beforeSubmit).",
    auth: "Session cookie",
    access: "Συνδεδεμένος χρήστης του tenant",
    body: [
      {
        name: "module",
        required: true,
        desc: "Entity module π.χ. customers, invoices, products, orders",
      },
      {
        name: "eventKey",
        required: true,
        desc: "π.χ. form.onLoad | form.onFieldChange | form.beforeSubmit",
      },
      {
        name: "record",
        required: true,
        desc: "Τρέχον record του form (object)",
      },
      { name: "previous", desc: "Προηγούμενο record (optional)" },
      { name: "field", desc: "Όνομα πεδίου (για onFieldChange)" },
      { name: "value", desc: "Νέα τιμή πεδίου" },
      { name: "mode", desc: "create | edit | view" },
    ],
    curl: `curl -sS -X POST https://YOUR_HOST/api/scripts/ui-event \\
  -H 'Cookie: softify_session=...' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "module": "customers",
    "eventKey": "form.onFieldChange",
    "field": "vatNumber",
    "value": "999999999",
    "mode": "edit",
    "record": {
      "code": "C-100",
      "name": "Αιγαίο Foods OE",
      "vatNumber": "999999999"
    }
  }'`,
    responseExample: `{
  "ok": true,
  "record": {
    "code": "C-100",
    "name": "Αιγαίο Foods OE",
    "vatNumber": "999999999",
    "taxOffice": "Α' Αθηνών"
  },
  "results": [
    {
      "scriptCode": "CUSTOMER_VAT_LOOKUP",
      "ok": true,
      "durationMs": 42,
      "logs": ["VAT validated"]
    }
  ]
}`,
    notes: [
      "Άγνωστο eventKey → 400 «Άγνωστο event».",
      "Scripts ρυθμίζονται στο /settings/scripts.",
    ],
  },
  {
    key: "configExport",
    path: "/api/settings/export",
    method: "GET",
    title: "Εξαγωγή ρυθμίσεων tenant",
    desc: "JSON snapshot οργανισμού, σειρών, πληρωμών, μονάδων, GL, ρόλων — χωρίς secrets.",
    auth: "Session cookie",
    access: "Μόνο OWNER / ADMIN",
    curl: `curl -sS https://YOUR_HOST/api/settings/export \\
  -H 'Cookie: softify_session=...' \\
  -o softifyos-tenant-config.json`,
    responseExample: `{
  "exportedAt": "2026-08-01T21:00:00.000Z",
  "format": "softifyos-config-v1",
  "tenant": { "slug": "akropolis", "name": "Ακρόπολις ΑΕ" },
  "organization": {
    "legalName": "Ακρόπολις ΑΕ",
    "vatNumber": "099999999",
    "currency": "EUR",
    "locale": "el-GR"
  },
  "documentSeries": [{ "code": "TDA", "kind": "SALES_INVOICE", "myDataEnabled": true }],
  "paymentMethods": [{ "code": "CASH", "name": "Μετρητά" }],
  "glAccounts": [{ "code": "30.00.00", "name": "Πελάτες", "type": "ASSET" }],
  "roles": [],
  "groups": [],
  "sites": []
}`,
    notes: [
      "Content-Disposition: attachment (κατέβασμα αρχείου).",
      "Δεν περιλαμβάνει passwords, webhook secrets, myDATA keys.",
    ],
  },
  {
    key: "integrationsTest",
    path: "/api/settings/integrations/test",
    method: "POST",
    title: "Test webhook / myDATA",
    desc: "Δοκιμαστική κλήση outbound webhook ή σύνδεσης myDATA· αποθηκεύει last test result.",
    auth: "Session cookie",
    access: "Μόνο OWNER / ADMIN",
    body: [
      {
        name: "target",
        required: true,
        desc: '"webhook" ή "mydata"',
      },
    ],
    curl: `curl -sS -X POST https://YOUR_HOST/api/settings/integrations/test \\
  -H 'Cookie: softify_session=...' \\
  -H 'Content-Type: application/json' \\
  -d '{"target":"mydata"}'`,
    responseExample: `{
  "result": {
    "ok": true,
    "at": "2026-08-01T21:05:00.000Z",
    "message": "myDATA simulator OK",
    "latencyMs": 18,
    "status": 200
  }
}`,
  },
  {
    key: "apiTokens",
    path: "/api/settings/integrations/tokens",
    method: "GET | POST | PATCH",
    title: "Διαχείριση API tokens",
    desc: "Λίστα / δημιουργία / revoke tokens για εξωτερικές εφαρμογές.",
    auth: "Session cookie (διαχείριση). Το secret χρησιμοποιείται ως Bearer / X-Softify-Api-Key.",
    access: "GET: συνδεδεμένοι · POST/PATCH: OWNER / ADMIN",
    body: [
      {
        name: "name",
        required: true,
        desc: "POST — όνομα token (π.χ. ERP Integration)",
      },
      {
        name: "id",
        required: true,
        desc: "PATCH — id token προς revoke",
      },
      {
        name: "action",
        required: true,
        desc: 'PATCH — πρέπει να είναι "revoke"',
      },
    ],
    curl: `# Λίστα
curl -sS https://YOUR_HOST/api/settings/integrations/tokens \\
  -H 'Cookie: softify_session=...'

# Δημιουργία (το secret εμφανίζεται μία φορά)
curl -sS -X POST https://YOUR_HOST/api/settings/integrations/tokens \\
  -H 'Cookie: softify_session=...' \\
  -H 'Content-Type: application/json' \\
  -d '{"name":"Warehouse sync"}'

# Revoke
curl -sS -X PATCH https://YOUR_HOST/api/settings/integrations/tokens \\
  -H 'Cookie: softify_session=...' \\
  -H 'Content-Type: application/json' \\
  -d '{"id":"tok_…","action":"revoke"}'`,
    responseExample: `{
  "token": {
    "id": "tok_lx9k2",
    "name": "Warehouse sync",
    "prefix": "sfy_ab12",
    "createdAt": "2026-08-01T21:10:00.000Z",
    "lastUsedAt": null,
    "revokedAt": null,
    "active": true
  },
  "secret": "sfy_ab12…FULL_SECRET_ONCE…"
}`,
    notes: [
      "Μετά το POST φύλαξε το secret — δεν ξαναεμφανίζεται.",
      "Header παραδείγματα: Authorization: Bearer <secret> ή X-Softify-Api-Key: <secret>.",
    ],
  },
  {
    key: "marketplaceChannels",
    path: "/api/settings/marketplace-channels",
    method: "GET | POST",
    title: "Marketplace channels",
    desc: "CRUD καναλιών Skroutz / Shopify / Woo / BestPrice κ.ά. για sync μέσω Script Hooks.",
    auth: "Session cookie",
    access: "GET: συνδεδεμένοι · POST: OWNER / ADMIN",
    body: [
      { name: "code", required: true, desc: "Μοναδικός κωδικός (A-Z0-9_)" },
      { name: "name", required: true, desc: "Εμφανιζόμενο όνομα" },
      {
        name: "provider",
        required: true,
        desc: "SKROUTZ | BESTPRICE | PUBLIC | SHOPIFY | WOOCOMMERCE | AMAZON | CUSTOM",
      },
      { name: "merchantId", desc: "Shop / merchant id" },
      {
        name: "credentialsSecretKey",
        desc: "Κλειδί στο Script Secrets (όχι raw token)",
      },
      { name: "syncCatalog / syncOrders / syncStock / syncPrices", desc: "Boolean flags" },
    ],
    curl: `# Λίστα
curl -sS https://YOUR_HOST/api/settings/marketplace-channels \\
  -H 'Cookie: softify_session=...'

# Δημιουργία
curl -sS -X POST https://YOUR_HOST/api/settings/marketplace-channels \\
  -H 'Cookie: softify_session=...' \\
  -H 'Content-Type: application/json' \\
  -d '{"code":"SKROUTZ","name":"Skroutz","provider":"SKROUTZ","status":"ACTIVE","merchantId":"12345","credentialsSecretKey":"SKROUTZ_TOKEN","syncCatalog":true,"syncOrders":true}'`,
    responseExample: `{
  "item": {
    "id": "…",
    "code": "SKROUTZ",
    "provider": "SKROUTZ",
    "status": "ACTIVE",
    "merchantId": "12345",
    "lastSyncAt": null
  }
}`,
    notes: [
      "PATCH/DELETE: /api/settings/marketplace-channels/:id",
      "Sync heartbeat: POST /api/settings/marketplace-channels/:id/sync-ping",
      "UI: Ρυθμίσεις → Integrations → Marketplaces",
    ],
  },
  {
    key: "audit",
    path: "/api/audit-events",
    method: "GET",
    title: "Integration audit trail",
    desc: "Ιστορικό ενεργειών integrations / myDATA από το audit log.",
    auth: "Session cookie",
    access: "Συνδεδεμένοι με δικαίωμα audit (συνήθως ADMIN+)",
    params: [
      {
        name: "action",
        desc: "Πρόθεμα φίλτρου π.χ. integrations. ή mydata.",
      },
      { name: "take", desc: "Όριο αποτελεσμάτων (προαιρετικό)" },
    ],
    curl: `curl -sS 'https://YOUR_HOST/api/audit-events?action=integrations.' \\
  -H 'Cookie: softify_session=...'`,
    responseExample: `{
  "items": [
    {
      "id": "…",
      "action": "integrations.mydata_test",
      "entity": "tenant_settings",
      "createdAt": "2026-08-01T21:05:00.000Z",
      "meta": { "ok": true, "message": "myDATA simulator OK" }
    }
  ]
}`,
    notes: [
      "Πλήρες audit UI: /settings/audit",
      "Monitor tab σε αυτή τη σελίδα δείχνει πρόσφατα events.",
    ],
  },
];
