# Εγκατάσταση SoftifyOS σε server με Plesk

Οδηγός για Plesk Obsidian σε Linux (Ubuntu 22.04/24.04, Debian 12 ή AlmaLinux 9) με πρόσβαση SSH ως root.

## Τι θα τρέχει στον server

```
Internet ─HTTPS─► nginx (Plesk) ─┬─ /api/*  ─► softify-api    (Node, port 4000, 2 instances)
                                  └─ /*      ─► softify-web    (Next.js PWA, port 3000)
                                     softify-worker (push, υπενθυμίσεις, queue)
                                     PostgreSQL 17 (localhost:5432)
```

Το SSL είναι **υποχρεωτικό**: χωρίς HTTPS δεν δουλεύουν ούτε τα push notifications ούτε η εγκατάσταση PWA.

---

## 1. Προαπαιτούμενα (μία φορά)

1. **Domain/subdomain** στο Plesk, π.χ. `app.example.gr`. Ενεργοποίησε **Let's Encrypt SSL** με redirect HTTP→HTTPS.
2. **Node.js 22 ή 24**: Plesk → Extensions → *Node.js* (ή `nvm` / NodeSource μέσω SSH). Έλεγξε με `node -v`.
3. **PM2** (process manager):
   ```bash
   npm install -g pm2
   ```
4. **PostgreSQL 17** από το επίσημο repository (το ενσωματωμένο του Plesk είναι συχνά παλιότερη έκδοση):
   ```bash
   # Ubuntu/Debian
   sudo apt install -y postgresql-common && sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh
   sudo apt install -y postgresql-17 postgresql-contrib-17
   ```
   Δημιουργία βάσης και χρήστη:
   ```bash
   sudo -u postgres psql <<'SQL'
   CREATE ROLE softify LOGIN PASSWORD 'ΒΑΛΕ-ΙΣΧΥΡΟ-ΚΩΔΙΚΟ' CREATEROLE;
   CREATE DATABASE softifyos OWNER softify ENCODING 'UTF8' TEMPLATE template0;
   \c softifyos
   CREATE EXTENSION IF NOT EXISTS pg_trgm;
   SQL
   ```
   > Το `CREATEROLE` χρειάζεται μόνο για το πρώτο migration, που δημιουργεί τον εσωτερικό ρόλο `softify_app` για το Row Level Security.

5. **Ρύθμιση PostgreSQL για μεγάλο όγκο** (`/etc/postgresql/17/main/postgresql.conf`, ενδεικτικά για server 16GB RAM):
   ```
   shared_buffers = 4GB
   effective_cache_size = 12GB
   work_mem = 32MB
   maintenance_work_mem = 1GB
   max_connections = 200
   random_page_cost = 1.1          # SSD
   ```
   Μετά: `sudo systemctl restart postgresql`.

## 2. Ανέβασμα κώδικα

Με το **Git extension** του Plesk (pull από το repository σου) ή με `rsync`/SFTP, π.χ. στο
`/var/www/vhosts/example.gr/softifyos`.

## 3. Ρύθμιση `.env`

```bash
cd /var/www/vhosts/example.gr/softifyos
cp .env.example .env
nano .env
```

| Μεταβλητή | Τιμή |
|---|---|
| `DATABASE_URL` | `postgres://softify:ΚΩΔΙΚΟΣ@127.0.0.1:5432/softifyos` |
| `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `COOKIE_SECURE` | `true` |
| `VAPID_*` | από `npm run vapid` (μία φορά· **μην τα αλλάξεις μετά**, αλλιώς χάνονται οι συνδρομές push) |
| `VAPID_SUBJECT` | `mailto:` με το email του διαχειριστή |

## 4. Build, migrations, εκκίνηση

```bash
npm ci
npm run build          # API (TypeScript → dist) + Web (Next.js standalone)
npm run db:migrate     # δημιουργεί/ενημερώνει το σχήμα
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup            # ξεκινά αυτόματα μετά από reboot (εκτέλεσε την εντολή που εμφανίζει)
```

## 5. nginx στο Plesk

Plesk → Websites & Domains → `app.example.gr` → **Apache & nginx Settings**:

1. Άφησε το **Proxy mode** όπως είναι.
2. Στο **Additional nginx directives** επικόλλησε το περιεχόμενο του [`nginx-additional-directives.conf`](nginx-additional-directives.conf).
3. **OK**. Έλεγξε στο `https://app.example.gr/api/health`, όπου πρέπει να δεις `{"ok":true,...}`.

## 6. Ενημερώσεις (κάθε νέα έκδοση)

```bash
git pull           # ή μέσω Plesk Git
npm ci
npm run build
npm run db:migrate
pm2 reload all     # zero-downtime για web/api
```

## 7. Backups

Plesk → Backup Manager για τα αρχεία, και καθημερινό dump της βάσης (cron στο Plesk → Scheduled Tasks):

```bash
pg_dump -Fc -U softify softifyos > /var/backups/softifyos-$(date +%F).dump
```

## Κλιμάκωση όταν μεγαλώσει ο όγκος

| Σημάδι | Κίνηση |
|---|---|
| CPU του API > 70% | `instances` του `softify-api` = αριθμός πυρήνων |
| Πολλές συνδέσεις στη βάση | PgBouncer (transaction mode) και `DB_PREPARE=false` |
| Αργές αναφορές | Read replica του PostgreSQL |
| Αργή αναζήτηση σε δεκάδες εκατομμύρια | Typesense/Meilisearch (επόμενη φάση) |
| Ένας πολύ μεγάλος πελάτης-tenant | Δική του βάση (το σχήμα το υποστηρίζει χωρίς αλλαγές κώδικα) |

## Push σε iPhone

Στο iOS (16.4 και νεότερα) τα push λειτουργούν **μόνο** όταν ο χρήστης κάνει *Κοινοποίηση → Προσθήκη στην οθόνη Αφετηρίας*, ανοίξει την εφαρμογή από το εικονίδιο και πατήσει **Περισσότερα → Ενεργοποίηση push ειδοποιήσεων**. Η εφαρμογή εμφανίζει αυτή την οδηγία αυτόματα.
