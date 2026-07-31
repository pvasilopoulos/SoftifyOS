# SoftifyOS — Script Hooks Engine

Πλήρης οδηγός custom JavaScript hooks ανά module & event.

| | |
|---|---|
| UI | **Ρυθμίσεις → Script Hooks** (`/settings/scripts`) |
| Runtime | Node `vm` sandbox (server) |
| Contract | `async function run(ctx, api) { … }` |
| Έκδοση | Script Hooks Engine v1 |

---

## 1. Τι είναι

Το Script Hooks Engine επιτρέπει **ανά tenant** custom JS σε συγκεκριμένα γεγονότα (δημιουργία πελάτη, έκδοση τιμολογίου, κ.λπ.).

Τυπικές χρήσεις:

- Validation / business rules (`api.fail`)
- Αυτόματη συμπλήρωση πεδίων (`api.set`)
- Webhooks προς marketplace / ERP / WMS (`api.http.*` + secrets)
- Side-effects μετά από save (notify, sync)

---

## 2. Γρήγορη εκκίνηση

1. Άνοιξε **Ρυθμίσεις → Script Hooks**.
2. Επίλεξε module (π.χ. Πελάτες).
3. **Νέο** script → γράψε `run(ctx, api)`.
4. **Test run** (χωρίς να επηρεάσει δεδομένα).
5. **Publish** (μόνο `PUBLISHED` + ενεργά τρέχουν στην παραγωγή).
6. Αν χρειάζεσαι HTTP: πρόσθεσε **host** στην allow-list και **secret** (π.χ. `MARKETPLACE_TOKEN`).

Ελάχιστο script:

```js
async function run(ctx, api) {
  api.log("hello", ctx.module, ctx.eventKey);
}
```

---

## 3. Αρχιτεκτονική

```
API / UI event
    │
    ▼
dispatchScriptEvent()
    │  · scriptsEnabled?
    │  · PUBLISHED + isActive
    │  · runtime SERVER|BOTH (ή UI|BOTH)
    │  · sortOrder ASC
    ▼
για κάθε script:
    runScriptSource()  →  Node vm sandbox
         │
         ├─ api.set / fail / log
         ├─ api.secrets.get
         └─ api.http.*  (μόνο allow-listed hosts)
    │
    ├─ ScriptRunLog
    └─ αν fail → σταματάει η αλυσίδα
```

### Lifecycle

| Τιμή | Συμπεριφορά |
|------|-------------|
| `DRAFT` | Επεξεργασία / Test μόνο. **Δεν** τρέχει σε API. |
| `PUBLISHED` | Τρέχει σε παραγωγή αν `isActive = true`. |

### Runtime

| Τιμή | Πού τρέχει |
|------|------------|
| `SERVER` | Στο API / server dispatch |
| `UI` | Στο browser (όταν συνδεθεί το UI runner) |
| `BOTH` | Και στα δύο |

> **Σημαντικό:** Σήμερα το server dispatch εκτελεί μόνο `SERVER` / `BOTH`. Τα `form.*` / `list.onRowClick` είναι **UI events** — ορίζονται στον κατάλογο και δοκιμάζονται στο Test run· το UI wiring έρχεται σε επόμενο βήμα.

### Kill switch & όρια (ανά tenant)

| Ρύθμιση | Default | Σημασία |
|---------|---------|---------|
| `scriptsEnabled` | `true` | Αν `false`, κανένα script δεν τρέχει |
| `maxTimeoutMs` | `3000` | Ανώτατο timeout ανά run |
| `maxHttpCalls` | `5` | Μέγιστες HTTP κλήσεις ανά script run |
| `timeoutMs` (ανά script) | `3000` | 100–10000 ms (κόβεται από το max) |

---

## 4. Contract: `ctx` και `api`

Κάθε script **πρέπει** να ορίζει:

```js
async function run(ctx, api) {
  // ...
}
```

### 4.1 `ctx` (context)

| Πεδίο | Τύπος | Περιγραφή |
|-------|--------|-----------|
| `ctx.module` | string | π.χ. `"CUSTOMERS"`, `"INVOICES"` |
| `ctx.eventKey` | string | π.χ. `"before.create"` |
| `ctx.record` | object | Το τρέχον draft / αποθηκευμένο record |
| `ctx.previous` | object \| null | Προηγούμενη κατάσταση (σε update) |
| `ctx.user` | `{ id, role }` \| null | Χρήστης που προκάλεσε το event |

Επιπλέον πεδία ανά event (π.χ. `field`, `mode`, `row`, `from`, `to`) — βλ. ενότητες events.

### 4.2 `api` (API sandbox)

#### Ανάγνωση / εγγραφή

```js
api.get("record")              // ολόκληρο το record (clone)
api.get("record.vatNumber")    // πεδίο
api.get("vatNumber")           // shorthand → record.vatNumber
api.set("vatNumber", "123")    // γράφει στο record
api.set("record.status", "INACTIVE")
api.set("customFields.tier", "GOLD")
```

> Σε `before.*` τα `api.set` εφαρμόζονται στο draft **πριν** το DB write (μόνο επιτρεπόμενα keys από το API route).

#### Αποτυχία / validation

```js
api.fail("Το ΑΦΜ είναι υποχρεωτικό");
// → HTTP 400, μήνυμα στον χρήστη, σταματάει η αλυσίδα scripts
```

#### Logging

```js
api.log("sync start", ctx.record.code);
console.log("ίδιο με api.log"); // redirected
```

Τα logs εμφανίζονται στο **Test run** και εσωτερικά στο run result (όχι απαραίτητα στο UI χρήστη).

#### Secrets

```js
const token = await api.secrets.get("MARKETPLACE_TOKEN");
```

- Keys: `UPPER_SNAKE_CASE` (π.χ. `MARKETPLACE_TOKEN`)
- Αποθηκεύονται κρυπτογραφημένα (AES-256-GCM)
- Η τιμή **ποτέ** δεν επιστρέφεται στο UI μετά την αποθήκευση

#### HTTP

```js
const res = await api.http.get(url, { headers?, timeoutMs? });
const res = await api.http.post(url, body, { headers?, timeoutMs? });
const res = await api.http.put(url, body, options);
const res = await api.http.patch(url, body, options);
const res = await api.http.delete(url, options);
```

Απάντηση:

```js
{
  ok: boolean,       // res.ok του fetch
  status: number,
  headers: object,
  body: any          // JSON αν parse-άρεται, αλλιώς text
}
```

Κανόνες:

1. Το **hostname** πρέπει να είναι στην HTTP allow-list (ακριβές ή `*.example.com`).
2. Όριο κλήσεων: `maxHttpCalls` ανά run.
3. Timeout ανά κλήση: έως ~8s (προεπιλογή 5s).
4. Body στέλνεται ως JSON (`content-type: application/json`).

---

## 5. Modules & events (κατάλογος)

Modules: `CUSTOMERS` · `PRODUCTS` · `INVOICES` · `ORDERS` · `QUOTES` · `GIFT_CARDS`

### Κοινά CRUD events (όλα τα modules)

| Event | Phase | Μπορεί `fail` | Μεταλλάσσει record | Χρήση |
|-------|-------|---------------|--------------------|-------|
| `before.create` | before | ✅ | ✅ | Validation / defaults πριν το INSERT |
| `after.create` | after | ⚠️ | ❌* | Webhooks μετά το INSERT |
| `before.update` | before | ✅ | ✅ | Validation / sync πριν το UPDATE |
| `after.update` | after | ⚠️ | ❌* | Webhooks μετά το UPDATE |
| `before.delete` | before | ✅ | — | Μπλοκ διαγραφής |
| `after.delete` | after | ⚠️ | — | Cleanup / notify |

\* Μετά το save, mutations στο record **δεν** ξαναγράφονται στη βάση αυτόματα.

### Form events (UI)

| Event | Phase | ctx επιπλέον |
|-------|-------|--------------|
| `form.onLoad` | ui | `mode` (`create`/`edit`), `record` |
| `form.onFieldChange` | ui | `field`, `value`, `record` |
| `form.beforeSubmit` | ui | `record` |

### List events

| Event | Phase | ctx επιπλέον |
|-------|-------|--------------|
| `list.onRowClick` | ui | `row` |
| `list.onKanbanMove` | before | `row`, `from`, `to` |

### Invoice-only

| Event | Phase | Χρήση |
|-------|-------|-------|
| `invoice.beforeIssue` | before | Έλεγχοι πριν την έκδοση |
| `invoice.afterIssue` | after | Marketplace / myDATA side effects |

### Κατάσταση wiring (runtime)

| Event | CUSTOMERS | Άλλα modules |
|-------|-----------|--------------|
| `before.create` / `after.create` | ✅ API | 🔜 κατάλογος + Test |
| `before.update` / `after.update` | ✅ API | 🔜 κατάλογος + Test |
| `before.delete` / `after.delete` | 🔜 | 🔜 |
| `form.*` / `list.onRowClick` | 🔜 UI | 🔜 UI |
| `list.onKanbanMove` | 🔜 | 🔜 |
| `invoice.beforeIssue` / `afterIssue` | — | 🔜 |

> Μπορείς να γράψεις & να κάνεις **Test run** / **Publish** για οποιοδήποτε event του καταλόγου. Στην παραγωγή (API) σήμερα εκτελούνται τα customer create/update hooks.

Σε `after.*` αποτυχία σε customers: το record **έχει ήδη σωθεί**· η απάντηση μπορεί να περιέχει `warning` + `script` (όχι rollback).

---

## 6. Παραδείγματα ανά περίπτωση

### 6.1 Validation — υποχρεωτικό ΑΦΜ (`before.create`)

**Module:** `CUSTOMERS` · **Event:** `before.create` · **Runtime:** `SERVER`

```js
async function run(ctx, api) {
  const vat = (ctx.record.vatNumber || "").toString().trim();
  if (!vat) {
    api.fail("Το ΑΦΜ είναι υποχρεωτικό");
  }
  if (!/^\d{9}$/.test(vat)) {
    api.fail("Το ΑΦΜ πρέπει να έχει 9 ψηφία");
  }
  api.log("vat ok", vat);
}
```

---

### 6.2 Defaults — συμπλήρωση πεδίων (`before.create`)

```js
async function run(ctx, api) {
  if (!ctx.record.status) {
    api.set("status", "ACTIVE");
  }
  if (!ctx.record.notes) {
    api.set("notes", "Δημιουργήθηκε από Script Hook");
  }
  // custom field (αν υπάρχει ορισμός στο entity-views)
  api.set("customFields.source", "web");
  api.log("defaults applied");
}
```

---

### 6.3 Κανονικοποίηση κωδικού (`before.create` / `before.update`)

```js
async function run(ctx, api) {
  const code = String(ctx.record.code || "").trim().toUpperCase();
  if (!code) api.fail("Ο κωδικός είναι υποχρεωτικός");
  api.set("code", code);
}
```

---

### 6.4 Σύγκριση previous → record (`before.update`)

**Event:** `before.update`

```js
async function run(ctx, api) {
  const prev = ctx.previous || {};
  const next = ctx.record || {};

  if (prev.status === "INACTIVE" && next.status === "ACTIVE") {
    api.log("reactivating customer", next.code);
  }

  if (prev.status === "ACTIVE" && next.status === "INACTIVE") {
    if (!next.notes || !String(next.notes).includes("Απενεργοποίηση")) {
      api.fail("Για απενεργοποίηση συμπλήρωσε σημείωση με τη λέξη «Απενεργοποίηση»");
    }
  }

  // Απαγόρευση αλλαγής ΑΦΜ μετά τη δημιουργία
  if (prev.vatNumber && next.vatNumber !== prev.vatNumber) {
    api.fail("Το ΑΦΜ δεν αλλάζει μετά τη δημιουργία");
  }
}
```

---

### 6.5 Ρόλος χρήστη (`before.update`)

```js
async function run(ctx, api) {
  if (ctx.user?.role === "VIEWER") {
    api.fail("Δεν επιτρέπεται επεξεργασία");
  }
  // Παράδειγμα: μόνο OWNER αλλάζει status
  const prev = ctx.previous || {};
  if (
    prev.status !== ctx.record.status &&
    ctx.user?.role !== "OWNER" &&
    ctx.user?.role !== "ADMIN"
  ) {
    api.fail("Μόνο διαχειριστής μπορεί να αλλάξει κατάσταση");
  }
}
```

---

### 6.6 Marketplace webhook μετά τη δημιουργία (`after.create`)

**Προϋποθέσεις**

1. Allow-list: `api.marketplace.example` (ή το πραγματικό host)
2. Secret: `MARKETPLACE_TOKEN`

```js
async function run(ctx, api) {
  const token = await api.secrets.get("MARKETPLACE_TOKEN");

  const res = await api.http.post(
    "https://api.marketplace.example/v1/customers",
    {
      externalId: ctx.record.id,
      code: ctx.record.code,
      name: ctx.record.name,
      vatNumber: ctx.record.vatNumber,
      email: ctx.record.email,
    },
    {
      headers: {
        Authorization: "Bearer " + token,
        "X-Tenant": "softifyos",
      },
      timeoutMs: 5000,
    },
  );

  if (!res.ok) {
    api.fail(
      "Αποτυχία sync marketplace: HTTP " + res.status,
    );
  }

  api.log("marketplace synced", res.body);
}
```

> Σε `after.create`, αν κάνεις `api.fail`, ο πελάτης **έχει ήδη δημιουργηθεί**. Χρησιμοποίησε fail μόνο αν θέλεις να επισημάνεις το πρόβλημα· για «best effort» sync προτίμησε log χωρίς fail:

```js
async function run(ctx, api) {
  try {
    const token = await api.secrets.get("MARKETPLACE_TOKEN");
    const res = await api.http.post(
      "https://api.marketplace.example/v1/customers",
      { externalId: ctx.record.id, name: ctx.record.name },
      { headers: { Authorization: "Bearer " + token } },
    );
    api.log("sync", res.status, res.ok);
  } catch (e) {
    api.log("sync skipped", String(e && e.message ? e.message : e));
    // χωρίς api.fail → το create θεωρείται επιτυχές
  }
}
```

---

### 6.7 PATCH ενημέρωση σε τρίτο σύστημα (`after.update`)

```js
async function run(ctx, api) {
  const token = await api.secrets.get("MARKETPLACE_TOKEN");
  const prev = ctx.previous || {};
  const next = ctx.record || {};

  const changed = {};
  for (const key of ["name", "email", "phone", "status", "vatNumber"]) {
    if (prev[key] !== next[key]) changed[key] = next[key];
  }
  if (Object.keys(changed).length === 0) {
    api.log("no relevant changes");
    return;
  }

  const res = await api.http.patch(
    "https://api.marketplace.example/v1/customers/" + next.id,
    changed,
    { headers: { Authorization: "Bearer " + token } },
  );
  api.log("patched", res.status, changed);
}
```

---

### 6.8 GET εμπλουτισμός πριν τη δημιουργία (`before.create`)

Π.χ. lookup ΑΦΜ από εξωτερικό registry:

```js
async function run(ctx, api) {
  const vat = String(ctx.record.vatNumber || "").trim();
  if (!vat) return;

  const token = await api.secrets.get("VIES_API_KEY");
  const res = await api.http.get(
    "https://registry.example.com/v1/vat/" + encodeURIComponent(vat),
    { headers: { "X-Api-Key": token }, timeoutMs: 4000 },
  );

  if (!res.ok) {
    api.log("registry miss", res.status);
    return;
  }

  if (res.body && res.body.name && !ctx.record.name) {
    api.set("name", res.body.name);
  }
  if (res.body && res.body.address) {
    api.set("notes", "Διεύθυνση registry: " + res.body.address);
  }
}
```

---

### 6.9 Πολλαπλά scripts — σειρά (`sortOrder`)

Αν έχεις δύο published scripts στο ίδιο event:

| code | sortOrder | Ρόλος |
|------|-----------|-------|
| `normalize_code` | 0 | Κανονικοποιεί `code` |
| `require_vat` | 10 | Ελέγχει ΑΦΜ |
| `marketplace_push` | 20 | (σε after) webhook |

Η αλυσίδα σταματά στο **πρώτο** `api.fail` / error / timeout.

---

### 6.10 Διαγραφή — μπλοκ (`before.delete`)

```js
async function run(ctx, api) {
  if (ctx.record.status === "ACTIVE") {
    api.fail("Απενεργοποίησε πρώτα τον πελάτη πριν τη διαγραφή");
  }
  api.log("delete allowed", ctx.record.id);
}
```

### 6.11 Μετά τη διαγραφή — notify (`after.delete`)

```js
async function run(ctx, api) {
  const token = await api.secrets.get("MARKETPLACE_TOKEN");
  await api.http.delete(
    "https://api.marketplace.example/v1/customers/" + ctx.record.id,
    { headers: { Authorization: "Bearer " + token } },
  );
  api.log("remote deleted", ctx.record.id);
}
```

---

### 6.12 Form — φόρτωση (`form.onLoad`) · UI

```js
async function run(ctx, api) {
  api.log("form load", ctx.mode);
  if (ctx.mode === "create" && !ctx.record.status) {
    api.set("status", "ACTIVE");
  }
}
```

### 6.13 Form — αλλαγή πεδίου (`form.onFieldChange`) · UI

```js
async function run(ctx, api) {
  if (ctx.field === "status" && ctx.value === "INACTIVE") {
    api.log("user set inactive");
    // μελλοντικά: hide/show fields μέσω UI api extensions
  }
}
```

### 6.14 Form — πριν την υποβολή (`form.beforeSubmit`) · UI

```js
async function run(ctx, api) {
  if (!ctx.record.email && !ctx.record.phone) {
    api.fail("Συμπλήρωσε email ή τηλέφωνο");
  }
}
```

---

### 6.15 List — κλικ γραμμής (`list.onRowClick`) · UI

```js
async function run(ctx, api) {
  api.log("row click", ctx.row && ctx.row.id);
  // μελλοντικά: ακύρωση navigate / άνοιγμα peek
}
```

### 6.16 Kanban move (`list.onKanbanMove`)

```js
async function run(ctx, api) {
  api.log("kanban", ctx.from, "→", ctx.to, ctx.row && ctx.row.id);
  if (ctx.to === "INACTIVE" && ctx.user?.role === "MEMBER") {
    api.fail("Τα μέλη δεν απενεργοποιούν από kanban");
  }
}
```

---

### 6.17 Προϊόντα — έλεγχος τιμής (`PRODUCTS` · `before.create`)

```js
async function run(ctx, api) {
  const price = Number(ctx.record.price);
  if (Number.isNaN(price) || price < 0) {
    api.fail("Μη έγκυρη τιμή");
  }
  if (price === 0) {
    api.set("notes", (ctx.record.notes || "") + " [ΔΩΡΕΑΝ]");
  }
  const sku = String(ctx.record.sku || "").trim().toUpperCase();
  api.set("sku", sku);
}
```

---

### 6.18 Παραγγελίες — ελάχιστο σύνολο (`ORDERS` · `before.create`)

```js
async function run(ctx, api) {
  const total = Number(ctx.record.total || 0);
  if (total > 0 && total < 10) {
    api.fail("Ελάχιστο σύνολο παραγγελίας 10€");
  }
}
```

---

### 6.19 Προσφορές — λήξη (`QUOTES` · `before.create`)

```js
async function run(ctx, api) {
  if (!ctx.record.validUntil) {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    api.set("validUntil", d.toISOString().slice(0, 10));
  }
}
```

---

### 6.20 Δωροκάρτες — όριο ποσού (`GIFT_CARDS` · `before.create`)

```js
async function run(ctx, api) {
  const amount = Number(ctx.record.amount || 0);
  if (amount > 500) {
    api.fail("Μέγιστο ποσό δωροκάρτας 500€ χωρίς έγκριση");
  }
  if (amount <= 0) {
    api.fail("Το ποσό πρέπει να είναι θετικό");
  }
}
```

---

### 6.21 Τιμολόγιο — πριν την έκδοση (`invoice.beforeIssue`)

```js
async function run(ctx, api) {
  if (!ctx.record.customerId) {
    api.fail("Λείπει πελάτης");
  }
  const total = Number(ctx.record.total || 0);
  if (total <= 0) {
    api.fail("Δεν εκδίδεται τιμολόγιο με μηδενικό σύνολο");
  }
  api.log("issue checks ok", ctx.record.number);
}
```

### 6.22 Τιμολόγιο — μετά την έκδοση / marketplace (`invoice.afterIssue`)

```js
async function run(ctx, api) {
  const token = await api.secrets.get("MARKETPLACE_TOKEN");
  const res = await api.http.post(
    "https://api.marketplace.example/v1/invoices",
    {
      externalId: ctx.record.id,
      number: ctx.record.number,
      total: ctx.record.total,
      issuedAt: ctx.record.issuedAt || new Date().toISOString(),
    },
    { headers: { Authorization: "Bearer " + token } },
  );
  if (!res.ok) {
    api.log("invoice sync failed", res.status, res.body);
    // προαιρετικά: api.fail(...) αν θέλεις hard signal
  } else {
    api.log("invoice synced", res.body);
  }
}
```

---

## 7. Marketplace checklist (πλήρες σενάριο)

1. **Secrets** → `MARKETPLACE_TOKEN` = `sk_live_…`
2. **HTTP allow-list** → `api.your-marketplace.com` (χωρίς `https://`)
3. Script `CUSTOMERS` / `after.create` / `SERVER` / Publish (παράδειγμα §6.6)
4. Script `CUSTOMERS` / `after.update` / Publish (§6.7)
5. (Προαιρετικά) `before.create` validation ΑΦΜ (§6.1)
6. Test run με sample context
7. Δημιούργησε δοκιμαστικό πελάτη και δες **Runs** tab

Wildcard host:

```
*.your-marketplace.com
```

επιτρέπει `api.your-marketplace.com` και `eu.your-marketplace.com`.

---

## 8. Test run

Από το UI (**Test run**) ή API:

`POST /api/settings/scripts/test`

```json
{
  "module": "CUSTOMERS",
  "eventKey": "before.create",
  "source": "async function run(ctx, api) { api.log(ctx.record); }",
  "timeoutMs": 3000,
  "context": {
    "record": { "code": "T-1", "name": "Test", "vatNumber": null }
  }
}
```

Απάντηση (σχήμα):

```json
{
  "result": {
    "ok": true,
    "record": { "...": "..." },
    "logs": ["..."],
    "httpCalls": 0,
    "durationMs": 12
  }
}
```

Το test χρησιμοποιεί **πραγματικά** secrets & allow-list του tenant (προσοχή σε production tokens).

---

## 9. API ρυθμίσεων (αναφορά)

| Μέθοδος | Διαδρομή | Περιγραφή |
|---------|----------|-----------|
| `GET` | `/api/settings/scripts` | Λίστα scripts, secrets, allowlist, settings, logs |
| `POST` | `/api/settings/scripts` | Δημιουργία |
| `PATCH` | `/api/settings/scripts/:id` | Ενημέρωση / publish |
| `DELETE` | `/api/settings/scripts/:id` | Διαγραφή |
| `POST` | `/api/settings/scripts/test` | Test run |
| `POST` | `/api/settings/scripts/secrets` | Upsert secret |
| `DELETE` | `/api/settings/scripts/secrets/:id` | Διαγραφή secret |
| `POST` | `/api/settings/scripts/allowlist` | Προσθήκη host |
| `DELETE` | `/api/settings/scripts/allowlist/:id` | Αφαίρεση host |
| `PATCH` | `/api/settings/scripts/settings` | Kill switch / όρια |

Δικαιώματα: `OWNER` / `ADMIN`.

Κωδικός script: `^[a-z][a-z0-9_]*$` (μοναδικός ανά module).

---

## 10. Πεδία `ctx.record` — Customers (runtime)

Στα wired customer hooks το record περιλαμβάνει ενδεικτικά:

| Πεδίο | Create | Update |
|-------|--------|--------|
| `id` | μόνο after | ναι |
| `code` | ναι | ναι |
| `name` | ναι | ναι |
| `vatNumber` | ναι | ναι |
| `email` | ναι | ναι |
| `phone` | ναι | ναι |
| `notes` | ναι | ναι |
| `status` | `ACTIVE` \| `INACTIVE` | ναι |
| `customFields` | object | object |

Επιτρεπόμενα keys από `api.set` που εφαρμόζονται στο DB (customers):  
`code`, `name`, `vatNumber`, `email`, `phone`, `notes`, `status`, `customFields`.

---

## 11. Ασφάλεια & περιορισμοί

| Θέμα | Συμπεριφορά |
|------|-------------|
| Sandbox | Node `vm` — όχι πρόσβαση σε `fs`, `process`, DB, `require` |
| HTTP | Μόνο allow-listed hosts |
| Secrets | Κρυπτογραφημένα at rest· μόνο `secrets.get` στο script |
| Timeout | Ανά script + tenant max |
| HTTP calls | Soft limit ανά run |
| `eval` / δυναμικός κώδικας | Μόνο ο ορισμένος `run` |
| Multi-tenant | Όλα φιλτράρονται με `tenantId` |

**Μην** βάζεις secrets μέσα στον κώδικα του script — πάντα `api.secrets.get`.

---

## 12. Troubleshooting

| Σύμπτωμα | Έλεγχος |
|----------|---------|
| Το script δεν τρέχει | `PUBLISHED`; `isActive`; runtime `SERVER`/`BOTH`; kill switch on |
| `Host μη επιτρεπόμενος` | Allow-list χωρίς `https://` |
| `Secret δεν βρέθηκε` | Key ακριβώς όπως στο Secrets tab |
| `Timeout` | Αύξησε `timeoutMs` / μείωσε HTTP |
| `Υπέρβαση ορίου HTTP` | Λιγότερες κλήσεις ή αύξησε `maxHttpCalls` |
| Create πέρασε αλλά sync απέτυχε | `after.*` — δες Runs· χρησιμοποίησε log χωρίς fail για soft sync |
| Αλλαγές `api.set` αγνοούνται | Μόνο σε `before.*` και μόνο allowed keys |

Καρτέλα **Runs** στο `/settings/scripts`: τελευταία 30 εκτελέσεις (success, ms, httpCalls, error).

---

## 13. Αντιγραφή-έτοιμο «πακέτο» Customers + Marketplace

**Script A** — `require_vat` · `before.create` · PUBLISHED

```js
async function run(ctx, api) {
  const vat = String(ctx.record.vatNumber || "").trim();
  if (!/^\d{9}$/.test(vat)) {
    api.fail("Απαιτείται έγκυρο ΑΦΜ (9 ψηφία)");
  }
}
```

**Script B** — `push_marketplace` · `after.create` · PUBLISHED

```js
async function run(ctx, api) {
  const token = await api.secrets.get("MARKETPLACE_TOKEN");
  const res = await api.http.post(
    "https://api.marketplace.example/v1/customers",
    {
      externalId: ctx.record.id,
      code: ctx.record.code,
      name: ctx.record.name,
      vatNumber: ctx.record.vatNumber,
    },
    { headers: { Authorization: "Bearer " + token } },
  );
  api.log("marketplace", res.status, res.ok);
}
```

**Script C** — `sync_marketplace` · `after.update` · PUBLISHED

```js
async function run(ctx, api) {
  const token = await api.secrets.get("MARKETPLACE_TOKEN");
  await api.http.patch(
    "https://api.marketplace.example/v1/customers/" + ctx.record.id,
    {
      name: ctx.record.name,
      email: ctx.record.email,
      status: ctx.record.status,
    },
    { headers: { Authorization: "Bearer " + token } },
  );
}
```

---

## 14. Σύνοψη events ανά module

| Event | CUS | PRD | INV | ORD | QUO | GFT |
|-------|:---:|:---:|:---:|:---:|:---:|:---:|
| `before.create` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `after.create` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `before.update` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `after.update` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `before.delete` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `after.delete` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `form.onLoad` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `form.onFieldChange` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `form.beforeSubmit` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `list.onRowClick` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `list.onKanbanMove` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `invoice.beforeIssue` | | | ✓ | | | |
| `invoice.afterIssue` | | | ✓ | | | |

---

*SoftifyOS Script Hooks Engine — εσωτερική τεκμηρίωση προϊόντος.*
