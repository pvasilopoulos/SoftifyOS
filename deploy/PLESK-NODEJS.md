# SoftifyOS στο Plesk με το Node.js του Plesk (χωρίς root / SSH)

Για λογαριασμό Plesk **χωρίς** δικαιώματα διαχειριστή server. Όλα γίνονται από τον browser:
- **Node.js** (Websites & Domains → app.softify.gr → Node.js)
- **File Manager**
- **Git**

```
Internet ─HTTPS─► Plesk (Passenger) ─► app.js ─► Next.js PWA ── /api ──► API     (127.0.0.1:4517, παρασκήνιο)
                                                                         Worker  (παρασκήνιο: push, email, υπενθυμίσεις)
                                                                         PostgreSQL στη Neon (cloud)
```

Αν αποκτήσεις root, ο πλήρης τρόπος είναι το [PLESK.md](PLESK.md).

## Βήμα 1 · Βάση δεδομένων στη Neon

Η PostgreSQL του Plesk δεν κάνει, γιατί δεν επιτρέπει τη δημιουργία του ρόλου ασφαλείας που χρησιμοποιεί η εφαρμογή.

1. https://neon.tech → εγγραφή → **New project**:
   - Postgres **17**
   - Region **AWS Europe (Frankfurt)**
2. **Connect** → **απενεργοποίησε** το *Connection pooling* → αντέγραψε το connection string. Ξεκινά με `postgresql://` και τελειώνει με `?sslmode=require`.

> Ο worker της εφαρμογής ελέγχει τη βάση συνεχώς, οπότε η βάση δεν «κοιμάται». Δες στη Neon αν το δωρεάν πακέτο φτάνει για όλο τον μήνα, αλλιώς χρειάζεται το φθηνότερο επί πληρωμή. Η Neon κρατά και τα backups της βάσης, με επαναφορά σε οποιαδήποτε στιγμή.

## Βήμα 2 · Τελευταίος κώδικας

**Websites & Domains → softify.gr → Git** → **Pull Updates**. Ο κώδικας είναι στον φάκελο `app.softify.gr`.

## Βήμα 3 · Ρυθμίσεις Node.js

**Websites & Domains → app.softify.gr → Node.js**:

| Ρύθμιση | Τιμή |
|---|---|
| Node.js Version | **26** |
| Package Manager | npm |
| **Document Root** | **`/app.softify.gr/apps/web/public`** ⚠️ |
| Application Mode | production |
| Application Root | `/app.softify.gr` |
| Application Startup File | `app.js` |

⚠️ Το **Document Root** πρέπει να αλλάξει οπωσδήποτε. Αλλιώς τα αρχεία της εφαρμογής, μαζί με το `.env` που περιέχει τους κωδικούς, γίνονται προσβάσιμα από το web.

Μην πατήσεις **Auto-configure** και μην πατήσεις ακόμα **Enable Node.js**.

## Βήμα 4 · Ρυθμίσεις (.env)

Καρτέλα **Run Node.js commands**. Βάλε το δικό σου connection string από το βήμα 1:

```
npm run plesk -- init --db "postgresql://…@ep-….eu-central-1.aws.neon.tech/neondb?sslmode=require"
```

Δημιουργεί το `.env` με νέα κλειδιά (JWT, VAPID για push), ελεύθερη θύρα για το API και το mail server του Plesk. Ως διαχειριστής πλατφόρμας ορίζεται το `admin@softify.gr`. Άλλο email δίνεται με `--email`.

## Βήμα 5 · Build

```
npm run plesk -- deploy
```

Τρέχει στο παρασκήνιο και διαρκεί 5–15 λεπτά. Κάνει εγκατάσταση πακέτων, build, migrations της βάσης και εκκίνηση.

Την πρόοδο τη βλέπεις στο **File Manager → app.softify.gr → .run → deploy.log** (ξανάνοιξέ το για ανανέωση). Τελειώνει όταν γράφει **`✓ Ολοκληρώθηκε`**.

> Αν το log σταματήσει με σφάλμα μνήμης (`heap out of memory` / `Killed`), ο λογαριασμός hosting δεν έχει αρκετή RAM για το build. Στείλε μου το log.

## Βήμα 6 · Ενεργοποίηση

1. Στη σελίδα Node.js πάτησε **Enable Node.js** και μετά **Restart App**.
2. Έλεγχος: το https://app.softify.gr/api/health πρέπει να δείχνει `{"ok":true,…}`.
3. Με `npm run plesk -- status` (Run Node.js commands) βλέπεις τις υπηρεσίες και την υγεία τους.

## Βήμα 7 · Ο οργανισμός σου και ο πρώτος διαχειριστής

1. **File Manager → app.softify.gr**: φτιάξε το αρχείο **`admin-password.txt`** με μόνο τον κωδικό μέσα (τουλάχιστον 10 χαρακτήρες).
2. **Run Node.js commands**:
   ```
   npm run plesk -- admin --slug softify --name "Softify" --company "Softify Μ.Ι.Κ.Ε." --vat 000000000 --email admin@softify.gr --full-name "Όνομα Επώνυμο"
   ```
   Το αρχείο με τον κωδικό σβήνεται αυτόματα.
3. Σύνδεση στο **https://app.softify.gr/el/login**.

## Βήμα 8 · Να μένει πάντα ενεργό

Το Plesk σταματά την εφαρμογή όταν δεν έχει επισκέψεις. Το API και ο worker συνεχίζουν, αλλά για σιγουριά πρόσθεσε έναν έλεγχο κάθε 5 λεπτά:

**Websites & Domains → softify.gr → Scheduled Tasks → Add Task**:
- Task type: **Fetch a URL**
- URL: `https://app.softify.gr/api/health`
- Run: **Cron style** `*/5 * * * *`
- Notify: Do not notify

Κάθε φορά που τρέχει, η εφαρμογή ελέγχει ότι το API και ο worker τρέχουν, και τα ξεκινά αν έχουν σταματήσει.

## Βήμα 9 · Email

- **Mail Settings** του `softify.gr`: ενεργό Mail, **SPF** και **DKIM**.
- Δοκιμή από **Ρυθμίσεις → Email → Αποστολή δοκιμής**.
- Για Microsoft 365 / Google: στην εφαρμογή του Entra / Google Cloud πρόσθεσε το Redirect URI
  `https://app.softify.gr/api/calendar/oauth/microsoft/callback` (ή `…/google/callback`).

---

## Ενημέρωση σε νέα έκδοση

1. Push στο GitHub, και μετά **Git → Pull Updates** (ή αυτόματα, αν έχεις βάλει το webhook).
2. **Node.js → Run Node.js commands**:
   ```
   npm run plesk -- deploy
   ```
3. Περίμενε το `✓ Ολοκληρώθηκε` στο `.run/deploy.log`.

Κατά το build, η εφαρμογή μπορεί να δίνει σφάλματα για 1–2 λεπτά. Οι migrations τρέχουν αυτόματα. Το `.env`, τα έγγραφα και η βάση δεν αγγίζονται.

## Αλλαγή ρυθμίσεων

Άνοιξε το **`.env`** στον File Manager (app.softify.gr), άλλαξε ό,τι χρειάζεσαι (π.χ. `PLATFORM_ADMINS`, Stripe) και μετά τρέξε:

```
npm run plesk -- restart
```

## Εντολές (Run Node.js commands)

| Εντολή | Τι κάνει |
|---|---|
| `npm run plesk -- status` | Υπηρεσίες και υγεία |
| `npm run plesk -- restart` | Επανεκκίνηση API, worker και web |
| `npm run plesk -- deploy` | Εγκατάσταση, build, migrations και επανεκκίνηση |
| `npm run plesk -- migrate` | Μόνο migrations βάσης |
| `npm run plesk -- stop` | Σταματά API και worker |

Logs: **File Manager → app.softify.gr → .run →** `api.log`, `worker.log`, `deploy.log`.

## Διαφορές από την εγκατάσταση με root

| | Με root ([PLESK.md](PLESK.md)) | Plesk Node.js |
|---|---|---|
| Βάση | PostgreSQL στον server | Neon (cloud) |
| Backup βάσης | `backup.sh` και Ρυθμίσεις → Backup | Neon (επαναφορά σε οποιαδήποτε στιγμή). Η ενότητα «Ρυθμίσεις → Backup» δεν χρησιμοποιείται. |
| Backup εγγράφων | `backup.sh` | **Plesk → Backup Manager** του softify.gr (φάκελος `apps/api/storage`) |
| Υπηρεσίες | PM2 | `app.js` + έλεγχος κάθε 5 λεπτά |
| Χωρητικότητα | Μεγάλη (πολλά instances API) | Μικρή–μεσαία (ένα instance) |
