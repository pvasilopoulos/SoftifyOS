# Εγκατάσταση SoftifyOS στο app.softify.gr (Ubuntu + Plesk)

Χρόνος: περίπου 20 λεπτά. Χρειάζεσαι πρόσβαση **SSH ως root** στον server.
Χωρίς SSH: δες την ενότητα [Εγκατάσταση χωρίς SSH](#εγκατάσταση-χωρίς-ssh-μόνο-από-το-plesk) στο τέλος.

```
Internet ─HTTPS─► nginx (Plesk) ─┬─ /api/*  ─► softify-api     (127.0.0.1:4000, 2 instances)
                                  └─ /*      ─► softify-web     (127.0.0.1:3000, Next.js PWA)
                                     softify-worker  (push, email, υπενθυμίσεις)
                                     PostgreSQL 17   (127.0.0.1, μόνο τοπικά)
```

Ο κώδικας μπαίνει στο `/opt/softifyos` και τρέχει με τον χρήστη συστήματος `softify` (όχι root), μέσω PM2 με αυτόματη εκκίνηση.

---

## Βήμα 1 · Subdomain και SSL στο Plesk

1. **Websites & Domains → Add Subdomain** → `app` στο `softify.gr`.
2. Αν το DNS του `softify.gr` δεν το διαχειρίζεται το Plesk, πρόσθεσε στον πάροχο DNS μια εγγραφή **A**: `app` → IP του server.
3. **SSL/TLS Certificates → Let's Encrypt** για το `app.softify.gr`, και ενεργοποίησε την ανακατεύθυνση **HTTP → HTTPS**.

> Χωρίς HTTPS δεν δουλεύουν ούτε τα push ούτε η εγκατάσταση της εφαρμογής στο κινητό.

## Βήμα 2 · Πακέτο έκδοσης (στον υπολογιστή σου)

```bash
npm run release
```

Δημιουργεί το `release/softifyos-ΗΜΕΡΟΜΗΝΙΑ.tar.gz`. Δεν περιέχει `.env`, κωδικούς ή demo δεδομένα. Ανέβασέ το στον server:

```bash
scp release/softifyos-*.tar.gz root@app.softify.gr:/root/
```

(Εναλλακτικά: Plesk → File Manager → ανέβασμα στο `/root`.)

## Βήμα 3 · Αρχική εγκατάσταση (SSH, μία φορά)

```bash
ssh root@app.softify.gr
mkdir -p /opt/softifyos && tar -xzf /root/softifyos-*.tar.gz -C /opt/softifyos
sudo bash /opt/softifyos/deploy/setup-server.sh
```

Το script:
- εγκαθιστά **Node.js 26 (LTS)**, **PostgreSQL 17** και **PM2**,
- δημιουργεί τον χρήστη `softify` και τη βάση `softifyos` με τυχαίο ισχυρό κωδικό,
- παράγει το `/opt/softifyos/.env` με νέα κλειδιά (JWT, VAPID για push),
- ρυθμίζει την PostgreSQL ανάλογα με τη RAM του server,
- ορίζει αυτόματη εκκίνηση μετά από reboot και **καθημερινό backup** της βάσης (03:15, κρατά 14 ημέρες, στο `/var/backups/softifyos`).

> Αν οι θύρες 3000/4000 είναι πιασμένες από άλλη εφαρμογή, το script σταματά και σου λέει πώς να δώσεις άλλες, π.χ. `WEB_PORT=3100 API_PORT=4100 sudo -E bash …`. Τότε άλλαξε τις ίδιες θύρες και στις nginx directives του βήματος 5.

## Βήμα 4 · Build και εκκίνηση

```bash
sudo bash /opt/softifyos/deploy/deploy.sh
```

Στο τέλος πρέπει να δεις `✓ Το SoftifyOS τρέχει.`

## Βήμα 5 · nginx στο Plesk

Plesk → **app.softify.gr → Hosting & DNS → Apache & nginx Settings**:

1. **Ξετσέκαρε** το *Serve static files directly by nginx*. Αλλιώς τα αρχεία της εφαρμογής (`/_next/static/…`) δίνουν 404.
2. Στο **Additional nginx directives** επικόλλησε όλο το περιεχόμενο του [`nginx-additional-directives.conf`](nginx-additional-directives.conf):
   ```bash
   cat /opt/softifyos/deploy/nginx-additional-directives.conf
   ```
3. **OK**. Έλεγχος: το https://app.softify.gr/api/health πρέπει να δείχνει `{"ok":true,…}`.

## Βήμα 6 · Ο οργανισμός σου και ο πρώτος διαχειριστής

```bash
sudo -u softify -H bash -c 'cd /opt/softifyos && npm run tenant:create -- \
  --slug softify --name "Softify" --company "Softify Μ.Ι.Κ.Ε." --vat 000000000 \
  --email admin@softify.gr --full-name "Όνομα Επώνυμο"'
```

Ο κωδικός ζητείται κρυφά (τουλάχιστον 10 χαρακτήρες) και δεν αποθηκεύεται στο ιστορικό εντολών. Μετά συνδέεσαι στο **https://app.softify.gr/el/login**.

## Βήμα 7 · Email (για αποστολή προσφορών)

Το SoftifyOS στέλνει μέσω του mail server του Plesk (`localhost:25`), από το `no-reply@softify.gr`.

1. Βεβαιώσου ότι το **Mail** είναι ενεργό για το `softify.gr` (Plesk → Mail Settings).
2. Ενεργοποίησε **SPF** και **DKIM** (Mail Settings → DKIM spam protection), ώστε τα email να μην πηγαίνουν στα spam.
3. Για άλλον αποστολέα, άλλαξε το `SMTP_FROM` στο `/opt/softifyos/.env` και τρέξε `sudo -u softify pm2 reload all --update-env`.

Κάθε οργανισμός μπορεί επίσης να βάλει **δικό του SMTP** (Microsoft 365, Gmail, δικό του Plesk) από **Ρυθμίσεις → Email**, ώστε οι προσφορές να φεύγουν από το δικό του domain. Εκεί ορίζει και πρότυπα, υπογραφή και καταγραφή ανοίγματος. Ο κωδικός αποθηκεύεται κρυπτογραφημένος.

## Βήμα 8 · Push στο κινητό

1. Άνοιξε το https://app.softify.gr στο κινητό.
   - **iPhone:** Safari → Κοινοποίηση → *Προσθήκη στην οθόνη Αφετηρίας*, και μετά άνοιγμα από το εικονίδιο.
   - **Android:** Chrome → *Εγκατάσταση εφαρμογής*.
2. **Περισσότερα → Ενεργοποίηση push ειδοποιήσεων → Αποστολή δοκιμαστικής ειδοποίησης.**

## Βήμα 9 · Microsoft 365 / Google: ημερολόγιο και αποστολή email (προαιρετικό)

Με τις ίδιες δύο εφαρμογές OAuth:
- κάθε οργανισμός συνδέει το mailbox του από **Ρυθμίσεις → Email → «Σύνδεση με Microsoft 365 / Google»**, και τα email φεύγουν από εκεί χωρίς κωδικούς SMTP;
- κάθε χρήστης συνδέει το ημερολόγιό του.

Κάθε χρήστης συνδέει το Google Calendar ή το Outlook / Microsoft 365 από το **Ημερολόγιο → ⟳**.

Τα κλειδιά της εφαρμογής (Client ID / secret) μπαίνουν με δύο τρόπους:
- **ανά οργανισμό**, από **Ρυθμίσεις → Email → «Κλειδιά εφαρμογής Microsoft / Google»**, όπου εμφανίζεται και το Redirect URI για αντιγραφή;
- **για όλη την εγκατάσταση**, στο `.env`, όπως παρακάτω. Χρησιμοποιούνται όταν ένας οργανισμός δεν έχει δικά του.

Και στις δύο περιπτώσεις, η εφαρμογή δημιουργείται μία φορά:

**Google**
1. https://console.cloud.google.com → νέο project → **APIs & Services → Library** → ενεργοποίησε το **Google Calendar API**.
2. **OAuth consent screen**: External, όνομα «SoftifyOS», scopes `…/auth/calendar.events` και `…/auth/gmail.send`, και ενεργοποίησε και το **Gmail API**. Για δημόσια χρήση χρειάζεται επαλήθευση από τη Google.
3. **Credentials → Create credentials → OAuth client ID → Web application**, με Authorized redirect URI:
   `https://app.softify.gr/api/calendar/oauth/google/callback`
4. Στο `.env`: `GOOGLE_CLIENT_ID=…` και `GOOGLE_CLIENT_SECRET=…`

**Microsoft 365 / Outlook**
1. https://entra.microsoft.com → **App registrations → New registration**, με «Accounts in any organizational directory and personal Microsoft accounts».
2. Redirect URI (Web): `https://app.softify.gr/api/calendar/oauth/microsoft/callback`
3. **API permissions → Microsoft Graph → Delegated**: `Calendars.ReadWrite`, `Mail.Send`, `User.Read`, `offline_access`.
4. **Certificates & secrets → New client secret**.
5. Στο `.env`: `MS_CLIENT_ID=…` και `MS_CLIENT_SECRET=…`

Μετά: `sudo -u softify pm2 reload all --update-env`.

## Βήμα 10 · Συνδρομές με κάρτα – Stripe (προαιρετικό, για SaaS)

Χωρίς Stripe δεν υπάρχουν πακέτα ούτε όρια, άρα όλοι οι οργανισμοί έχουν τα πάντα. Με Stripe, κάθε νέος οργανισμός ξεκινά με **14 ημέρες δοκιμή** και μετά επιλέγει πακέτο από **Ρυθμίσεις → Συνδρομή**.

1. https://dashboard.stripe.com → **Products**: φτιάξε Starter, Business και Enterprise, το καθένα με δύο recurring τιμές (μηνιαία και ετήσια, σε EUR).
2. **Developers → Webhooks → Add endpoint**: `https://app.softify.gr/api/billing/webhook`, με events
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`.
3. **Settings → Billing → Customer portal**: ενεργοποίησε την αλλαγή πακέτου, την ακύρωση και τα τιμολόγια.
4. Στο `.env`:
   ```
   STRIPE_SECRET_KEY=sk_live_…
   STRIPE_WEBHOOK_SECRET=whsec_…
   STRIPE_PRICE_STARTER_MONTH=price_…    STRIPE_PRICE_STARTER_YEAR=price_…
   STRIPE_PRICE_BUSINESS_MONTH=price_…   STRIPE_PRICE_BUSINESS_YEAR=price_…
   STRIPE_PRICE_ENTERPRISE_MONTH=price_… STRIPE_PRICE_ENTERPRISE_YEAR=price_…
   ```
5. `sudo -u softify pm2 reload all --update-env`

Δοκίμασε πρώτα με κλειδιά **test mode** (`sk_test_…`) και την κάρτα `4242 4242 4242 4242`. Οι οργανισμοί που υπήρχαν πριν από τις συνδρομές μένουν στο Enterprise.
Αν μια συνδρομή λήξει ή μια πληρωμή εκκρεμεί πάνω από 7 ημέρες, ο οργανισμός περνά σε **μόνο ανάγνωση**: βλέπει τα δεδομένα του αλλά δεν αλλάζει τίποτα μέχρι να πληρώσει.

## Βήμα 11 · Backup, επαναφορά, παρακολούθηση

### Backup (αυτόματο)
Κάθε βράδυ στις 03:15 το `deploy/backup.sh` κρατά **βάση + έγγραφα** στο `/var/backups/softifyos/<ημερομηνία>/`:
14 ημερήσια, 8 εβδομαδιαία και 12 μηνιαία, με checksums. Log: `/var/log/softifyos-backup/`.

Όλα αυτά φαίνονται και στο **Ρυθμίσεις → Backup** (κατάσταση, δοκιμή επαναφοράς, «Backup τώρα», λήψη, διαγραφή) και στο **Ρυθμίσεις → Υγεία συστήματος** (έλεγχοι, server, βάση, ουρά, σφάλματα). Τα βλέπουν μόνο οι διαχειριστές της πλατφόρμας: βάλε στο `.env` `PLATFORM_ADMINS=email1,email2`.

Συνιστάται έντονα, στο `.env`:
- `BACKUP_PASSPHRASE=…`: κρυπτογραφεί κάθε backup (AES-256). **Φύλαξέ τη και εκτός server**, γιατί χωρίς αυτήν το backup δεν ανοίγει.
- `BACKUP_REMOTE=…`: αντίγραφο **εκτός server**, ώστε ένα backup στον ίδιο δίσκο να μη χαθεί μαζί του. Ρύθμισε μία φορά το rclone (`sudo rclone config`, π.χ. Backblaze B2, S3 ή Google Drive) και βάλε π.χ. `BACKUP_REMOTE=b2:softifyos-backups`.

### Δοκιμή επαναφοράς (αυτόματη, κάθε Κυριακή)
Το `deploy/restore.sh --verify` επαναφέρει το τελευταίο backup σε **προσωρινή** βάση, μετρά οργανισμούς, πελάτες και προσφορές, και τη σβήνει. Η παραγωγή δεν αγγίζεται. Αποτέλεσμα: `/var/backups/softifyos/last-verify.json`.

### Επαναφορά (σε περίπτωση ανάγκης)
```bash
ls /var/backups/softifyos/                                   # διάλεξε backup
sudo bash /opt/softifyos/deploy/restore.sh 2026-11-17_0315   # ζητά να γράψεις το όνομα της βάσης για επιβεβαίωση
```
Πριν από την επαναφορά κρατά αυτόματα backup της τρέχουσας κατάστασης. Μετά σταματά την εφαρμογή, επαναφέρει βάση και έγγραφα, και την ξεκινά ξανά.

### Παρακολούθηση
- **https://app.softify.gr/api/health**: 200 όταν όλα είναι εντάξει, 503 όταν κάτι θέλει προσοχή (βάση, worker, ουρά εργασιών, παλιό ή αποτυχημένο backup). Βάλ' το σε **UptimeRobot** ή **Better Stack** (δωρεάν), με έλεγχο κάθε 1–5 λεπτά.
- **Σφάλματα**: κάθε νέο σφάλμα (API, worker ή browser) ομαδοποιείται και στέλνεται **μία φορά** στο `ALERT_EMAIL` και/ή στο `ALERT_WEBHOOK_URL` (Slack, Teams ή Discord). Τα βλέπεις και με:
  `sudo -u postgres psql softifyos -c "SELECT source, count, last_seen, message FROM error_events WHERE resolved_at IS NULL ORDER BY last_seen DESC LIMIT 20"`
  Όταν διορθωθεί κάτι: `UPDATE error_events SET resolved_at = now() WHERE fingerprint = '…'`. Αν ξαναεμφανιστεί, θα έρθει νέα ειδοποίηση.

---

## Ενημέρωση σε νέα έκδοση

```bash
npm run release                                            # στον υπολογιστή σου
scp release/softifyos-*.tar.gz root@app.softify.gr:/root/
ssh root@app.softify.gr "sudo bash /opt/softifyos/deploy/deploy.sh \$(ls -t /root/softifyos-*.tar.gz | head -1)"
```

Οι ενημερώσεις γίνονται χωρίς διακοπή λειτουργίας, και οι migrations της βάσης τρέχουν αυτόματα.

## Χρήσιμες εντολές

| Τι | Εντολή |
|---|---|
| Κατάσταση υπηρεσιών | `sudo -u softify pm2 ls` |
| Logs (live) | `sudo -u softify pm2 logs` |
| Επανεκκίνηση | `sudo -u softify pm2 reload all --update-env` |
| Backup τώρα | `sudo bash /opt/softifyos/deploy/backup.sh` |
| Έλεγχος backup | `sudo bash /opt/softifyos/deploy/restore.sh --verify` |
| Επαναφορά | `sudo bash /opt/softifyos/deploy/restore.sh <φάκελος>` |
| Υγεία | `curl -s https://app.softify.gr/api/health` |
| Δοκιμή φόρτου | `node scripts/loadtest.mjs --url https://app.softify.gr --users 50 --seconds 60` (δες παρακάτω) |

> Αν το Plesk είχε ήδη δική του PostgreSQL, η 17 μπαίνει σε άλλη θύρα (π.χ. 5433). Τα scripts backup και restore τη διαβάζουν από το `DATABASE_URL` του `.env`.

## Κλιμάκωση όταν μεγαλώσει ο όγκος

| Σημάδι | Κίνηση |
|---|---|
| CPU του API > 70% | `instances` του `softify-api` (στο `deploy/ecosystem.config.cjs`) = αριθμός πυρήνων |
| Πολλές συνδέσεις στη βάση | PgBouncer (transaction mode) + `DB_PREPARE=false` |
| Αργές αναφορές | Read replica της PostgreSQL |
| Αναζήτηση σε δεκάδες εκατομμύρια | Typesense/Meilisearch (επόμενη φάση) |

---

## Εγκατάσταση χωρίς SSH (μόνο από το Plesk)

Οι εντολές τρέχουν από τις **Scheduled Tasks** του Plesk ως root. Τα αρχεία και τα logs τα βλέπεις από τον **File Manager**.

**Απαιτείται:** λογαριασμός **διαχειριστή (admin)** του Plesk σε VPS ή server με Ubuntu 22.04 ή 24.04. Με απλό λογαριασμό hosting (subscription) δεν γίνεται.

> Πιο σύντομα: αν εγκαταστήσεις το extension **«SSH Terminal»** (Extensions, δωρεάν), έχεις τερματικό root μέσα στον browser και ακολουθείς τα βήματα 1–11 όπως είναι.

### Α · Subdomain, SSL και πακέτο
1. Κάνε το **Βήμα 1** (subdomain, Let's Encrypt, HTTP → HTTPS).
2. Στον υπολογιστή σου: `npm run release`.
3. **softify.gr → File Manager**. Στη **ρίζα** του domain φτιάξε τον φάκελο **`softify-install`**: δίπλα στο `httpdocs`, όχι μέσα του και όχι στον φάκελο του `app.softify.gr`, ώστε να μην είναι προσβάσιμος από το web.
4. Ανέβασε εκεί το `.tar.gz` και μετονόμασέ το σε **`softifyos.tar.gz`**.

Η πλήρης διαδρομή είναι `/var/www/vhosts/softify.gr/softify-install`. Στις εντολές παρακάτω την ορίζει η μεταβλητή `D`.

### Β · Η εργασία που τρέχει τις εντολές
**Tools & Settings → Scheduled Tasks → Add Task:**
- System user: `root`
- Task type: Run a command
- Run: Yearly
- Notify: Do not notify

Για κάθε βήμα: βάλε στο **Command** την εντολή του βήματος → **OK** → **Run Now**.

Οι μεγάλες εντολές τρέχουν στο παρασκήνιο (`setsid nohup … &`) και γράφουν την πρόοδο σε `.log` μέσα στο `softify-install`. Το log το ανοίγεις στον File Manager και το ξανανοίγεις για ανανέωση. Τα σύμβολα του τύπου `[1;35m` στο log είναι χρώματα τερματικού και αγνοούνται.

### Γ · Εγκατάσταση, build και εκκίνηση
```bash
D=/var/www/vhosts/softify.gr/softify-install; mkdir -p /opt/softifyos && tar -xzf $D/softifyos.tar.gz -C /opt/softifyos && setsid nohup bash -c "bash /opt/softifyos/deploy/setup-server.sh && bash /opt/softifyos/deploy/deploy.sh" > $D/install.log 2>&1 < /dev/null &
```
Χρειάζεται 5–15 λεπτά. Στο τέλος του `install.log` πρέπει να δεις **`✓ Το SoftifyOS τρέχει.`**

Αν το log γράφει ότι η θύρα χρησιμοποιείται ήδη, άλλαξε το `bash /opt/softifyos/deploy/setup-server.sh` σε `WEB_PORT=3100 API_PORT=4100 bash /opt/softifyos/deploy/setup-server.sh` και τρέξε ξανά. Βάλε τις ίδιες θύρες και στο nginx.

### Δ · nginx
Κάνε το **Βήμα 5**. Το περιεχόμενο του `nginx-additional-directives.conf` το ανοίγεις από το repo στον υπολογιστή σου.

### Ε · Πρώτος οργανισμός και διαχειριστής
1. Στο `softify-install` φτιάξε το αρχείο **`pw.txt`** και γράψε μέσα μόνο τον κωδικό του διαχειριστή (τουλάχιστον 10 χαρακτήρες).
2. Τρέξε την εντολή, με τα δικά σου στοιχεία στο τέλος. Το `pw.txt` σβήνεται αυτόματα. Έλεγχος: `tenant.log`.
```bash
D=/var/www/vhosts/softify.gr/softify-install; cd /opt/softifyos && sudo -u softify -H env SOFTIFY_PASSWORD="$(cat $D/pw.txt)" npm run tenant:create -- --slug softify --name "Softify" --company "Softify Μ.Ι.Κ.Ε." --vat 000000000 --email admin@softify.gr --full-name "Όνομα Επώνυμο" > $D/tenant.log 2>&1; rm -f $D/pw.txt
```

### ΣΤ · Αλλαγές στο `.env`
Για παράδειγμα `PLATFORM_ADMINS`, Stripe ή `ALERT_EMAIL`.

1. Αντιγραφή για επεξεργασία:
```bash
D=/var/www/vhosts/softify.gr/softify-install; cp /opt/softifyos/.env $D/env.txt && chown --reference=$D $D/env.txt && chmod 600 $D/env.txt
```
2. Επεξεργάσου το `env.txt` στον File Manager και αποθήκευσέ το.
3. Επιστροφή και επανεκκίνηση. Η εντολή σβήνει και το `env.txt`, που περιέχει όλους τους κωδικούς:
```bash
D=/var/www/vhosts/softify.gr/softify-install; install -o softify -g softify -m 600 $D/env.txt /opt/softifyos/.env && rm -f $D/env.txt && sudo -u softify -H pm2 reload all --update-env
```

### Ζ · Ενημέρωση σε νέα έκδοση
1. Στον υπολογιστή σου: `npm run release`.
2. Ανέβασε το νέο πακέτο στη θέση του `softify-install/softifyos.tar.gz`.
3. Τρέξε:
```bash
D=/var/www/vhosts/softify.gr/softify-install; setsid nohup bash /opt/softifyos/deploy/deploy.sh $D/softifyos.tar.gz > $D/update.log 2>&1 < /dev/null &
```
Στο `update.log` πρέπει να εμφανιστεί `✓ Το SoftifyOS τρέχει.`

### Χρήσιμες εντολές
| Τι | Command |
|---|---|
| Logs εφαρμογής | `sudo -u softify -H pm2 logs --lines 200 --nostream > /var/www/vhosts/softify.gr/softify-install/pm2.log 2>&1` |
| Κατάσταση | `sudo -u softify -H pm2 ls > /var/www/vhosts/softify.gr/softify-install/status.log 2>&1` |
| Επανεκκίνηση | `sudo -u softify -H pm2 reload all --update-env` |

Η υγεία του συστήματος, το «Backup τώρα», η λήψη backup και τα σφάλματα φαίνονται στην εφαρμογή, στις **Ρυθμίσεις → Υγεία συστήματος / Backup**.

Όταν τελειώσεις, άφησε την εργασία με Command `true`, ώστε να μη μείνει καμία ενεργή εντολή.
