# Εγκατάσταση SoftifyOS στο app.softify.gr (Ubuntu + Plesk)

Χρόνος: περίπου 20 λεπτά. Χρειάζεσαι πρόσβαση **SSH ως root** στον server.

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

## Βήμα 8 · Push στο κινητό

1. Άνοιξε το https://app.softify.gr στο κινητό.
   - **iPhone:** Safari → Κοινοποίηση → *Προσθήκη στην οθόνη Αφετηρίας*, και μετά άνοιγμα από το εικονίδιο.
   - **Android:** Chrome → *Εγκατάσταση εφαρμογής*.
2. **Περισσότερα → Ενεργοποίηση push ειδοποιήσεων → Αποστολή δοκιμαστικής ειδοποίησης.**

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
| Backup τώρα | `sudo -u postgres pg_dump -Fc softifyos > /root/softifyos.dump` |
| Restore | `sudo -u postgres pg_restore -d softifyos --clean /root/softifyos.dump` |

> Αν το Plesk είχε ήδη δική του PostgreSQL, η 17 μπαίνει σε άλλη θύρα (π.χ. 5433). Τη βλέπεις στο `DATABASE_URL` του `.env` και τη δίνεις με `-p 5433` στις εντολές backup/restore.

## Κλιμάκωση όταν μεγαλώσει ο όγκος

| Σημάδι | Κίνηση |
|---|---|
| CPU του API > 70% | `instances` του `softify-api` (στο `deploy/ecosystem.config.cjs`) = αριθμός πυρήνων |
| Πολλές συνδέσεις στη βάση | PgBouncer (transaction mode) + `DB_PREPARE=false` |
| Αργές αναφορές | Read replica της PostgreSQL |
| Αναζήτηση σε δεκάδες εκατομμύρια | Typesense/Meilisearch (επόμενη φάση) |
