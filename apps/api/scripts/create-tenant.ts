// Creates an organisation (tenant) and its first owner account.
//
//   npm run tenant:create -- --slug softify --name "Softify" --company "Softify Μ.Ι.Κ.Ε." \
//        --email admin@softify.gr --full-name "Όνομα Επώνυμο"
//
// The password is typed interactively (hidden) or read from SOFTIFY_PASSWORD. It is never a CLI
// argument, so it does not end up in shell history.
import postgres from 'postgres';
import { hash } from '@node-rs/argon2';
import { parseArgs } from 'node:util';

const { values: a } = parseArgs({
  options: {
    slug: { type: 'string' },
    name: { type: 'string' },
    company: { type: 'string' },
    vat: { type: 'string' },
    email: { type: 'string' },
    'full-name': { type: 'string' },
    role: { type: 'string', default: 'owner' },
  },
});

function fail(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

if (!a.slug || !/^[a-z0-9-]{2,40}$/.test(a.slug)) fail('--slug: 2-40 χαρακτήρες a-z, 0-9, - (π.χ. softify)');
if (!a.name) fail('--name: το όνομα του οργανισμού');
if (!a.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email)) fail('--email: έγκυρο email διαχειριστή');
if (!a['full-name']) fail('--full-name: ονοματεπώνυμο διαχειριστή');
if (!['owner', 'admin', 'manager', 'sales', 'viewer'].includes(a.role!)) fail('--role: owner | admin | manager | sales | viewer');

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) fail('Δώσε τον κωδικό στο SOFTIFY_PASSWORD ή τρέξε το script σε τερματικό.');
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    let s = '';
    const on = (d: Buffer) => {
      for (const c of d.toString('utf8')) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false); stdin.pause(); stdin.off('data', on);
          process.stdout.write('\n');
          return resolve(s);
        }
        if (c === '\u0003') process.exit(130); // Ctrl+C
        if (c === '\u007f' || c === '\b') s = s.slice(0, -1);
        else s += c;
      }
    };
    stdin.on('data', on);
  });
}

let password = process.env.SOFTIFY_PASSWORD ?? '';
if (!password) {
  password = await promptHidden('Κωδικός διαχειριστή (τουλάχιστον 10 χαρακτήρες): ');
  const again = await promptHidden('Ξανά τον κωδικό: ');
  if (password !== again) fail('Οι κωδικοί δεν ταιριάζουν.');
}
if (password.length < 10) fail('Ο κωδικός πρέπει να έχει τουλάχιστον 10 χαρακτήρες.');

const url = process.env.DATABASE_URL;
if (!url) fail('Λείπει το DATABASE_URL (.env).');
const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  const result = await sql.begin(async (tx) => {
    const [existing] = await tx`SELECT id FROM tenants WHERE slug = ${a.slug!}`;
    if (existing) fail(`Υπάρχει ήδη οργανισμός με slug "${a.slug}".`);
    const [tenant] = await tx`INSERT INTO tenants (slug, name) VALUES (${a.slug!}, ${a.name!}) RETURNING id`;
    await tx`SELECT provision_tenant(${tenant.id})`; // default approval flow + sample catalogue
    await tx`INSERT INTO companies (tenant_id, name, vat) VALUES (${tenant.id}, ${a.company ?? a.name!}, ${a.vat ?? null})`;

    const [user] = await tx`SELECT id FROM users WHERE lower(email) = lower(${a.email!})`;
    let userId: string;
    let created = false;
    if (user) {
      userId = user.id; // existing account: keep its password, just add the membership
    } else {
      const [u] = await tx`
        INSERT INTO users (email, password_hash, full_name) VALUES (${a.email!}, ${await hash(password)}, ${a['full-name']!})
        RETURNING id`;
      userId = u.id;
      created = true;
    }
    await tx`INSERT INTO memberships (tenant_id, user_id, role) VALUES (${tenant.id}, ${userId}, ${a.role!})`;
    return { tenantId: tenant.id as string, created };
  });
  console.log(`\n✓ Οργανισμός "${a.name}" (${a.slug}) δημιουργήθηκε.`);
  console.log(result.created
    ? `✓ Λογαριασμός ${a.email} δημιουργήθηκε με ρόλο ${a.role}.`
    : `✓ Ο υπάρχων λογαριασμός ${a.email} προστέθηκε με ρόλο ${a.role} (ο κωδικός του δεν άλλαξε).`);
  console.log(`\nΣύνδεση: ${(process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/el/login\n`);
} finally {
  await sql.end();
}
