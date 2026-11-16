# SoftifyOS

**Enterprise Business OS**: multitenant PWA για CRM, προσφορές, εγκρίσεις και ημερολόγιο, με live ενημερώσεις και push notifications. Ελληνικά και αγγλικά.

## Αρχιτεκτονική

```
apps/web     Next.js 15 PWA (React 19, Tailwind 4, next-intl, TanStack Query/Virtual)
apps/api     Fastify 5 API + background worker (TypeScript, postgres.js)
  db/migrations   SQL σχήμα (RLS, partitions, indexes)
  scripts/        migrate, seed (εκατομμύρια εγγραφές), dev-db, vapid
deploy/      PM2, nginx (Plesk), οδηγός εγκατάστασης
```

| Θέμα | Λύση |
|---|---|
| Multitenancy | Shared schema, `tenant_id` σε κάθε πίνακα και **PostgreSQL Row Level Security** (ρόλος `softify_app`). Ένα query χωρίς φίλτρο tenant **δεν μπορεί** να δει ξένα δεδομένα. |
| Ταχύτητα σε εκατομμύρια | Indexes που ξεκινούν από `tenant_id`, keyset (cursor) pagination, UUIDv7, partitioned `activities` ανά μήνα, προϋπολογισμένοι μετρητές για dashboards, trigram αναζήτηση χωρίς τόνους/κεφαλαία, virtualized λίστες |
| Live | Postgres `LISTEN/NOTIFY` → Server-Sent Events (δουλεύει με πολλά API instances) |
| Push | Web Push (VAPID) από τον worker, Android/desktop/iOS 16.4+ (εγκατεστημένο PWA) |
| Jobs | Queue μέσα στην Postgres (`FOR UPDATE SKIP LOCKED`), χωρίς Redis |

Μετρήσεις τοπικά, με 160k πελάτες, 480k προσφορές και 1,6M ενέργειες: λίστες και σελιδοποίηση σε 5–15ms, αναζήτηση σε 100k πελάτες περίπου 75ms, dashboard περίπου 80ms.

## Τοπική ανάπτυξη (Windows / macOS / Linux)

Χρειάζεται μόνο Node.js 24+ (στον server: 26 LTS). Η PostgreSQL τρέχει τοπικά μέσω του `embedded-postgres`, χωρίς εγκατάσταση.

**Κάθε μέρα:** μία εντολή σηκώνει βάση, migrations, API, worker και PWA. Με **Ctrl+C** σταματούν όλα.

```bash
npm run dev
```

Μετά άνοιξε το http://localhost:3000/el

> **Windows PowerShell:** αν βγάλει *"running scripts is disabled on this system"*, γράψε `npm.cmd run dev` (ίδια εντολή, παρακάμπτει το μπλοκάρισμα χωρίς αλλαγή ρυθμίσεων ασφαλείας).

**Πρώτη φορά μόνο:**

```bash
npm install
cp .env.example .env          # και συμπλήρωσε JWT_SECRET + VAPID (npm run vapid)
npm run dev                   # σηκώνει τη βάση και εφαρμόζει migrations
npm run db:seed               # (σε 2ο τερματικό) demo δεδομένα · SEED_SCALE=10 για ×10 όγκο
```

Μεμονωμένα, αν χρειαστεί: `npm run dev:db`, `dev:api`, `dev:worker`, `dev:web`.

Demo login: `demo@softifyos.local`. Ο κωδικός ορίζεται από το `SEED_PASSWORD` (default στο [apps/api/scripts/seed.ts](apps/api/scripts/seed.ts)).

## Παραγωγή

Βλ. [deploy/PLESK.md](deploy/PLESK.md).
