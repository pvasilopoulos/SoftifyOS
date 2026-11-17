// Sets a new password for an existing account (e.g. a forgotten administrator password).
//
//   npm run user:password -- --email admin@softify.gr
//
// The password is typed twice (hidden, shown as *) or read from SOFTIFY_PASSWORD; never a CLI argument.
import postgres from 'postgres';
import { hash } from '@node-rs/argon2';
import { parseArgs } from 'node:util';

const { values: a } = parseArgs({ options: { email: { type: 'string' } } });

function fail(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}
if (!a.email) fail('--email: το email του λογαριασμού');

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
        if (c === '\u007f' || c === '\b') { if (s) { s = s.slice(0, -1); process.stdout.write('\b \b'); } }
        else { s += c; process.stdout.write('*'); } // one * per character: typing is visible, the password is not
      }
    };
    stdin.on('data', on);
  });
}

let password = process.env.SOFTIFY_PASSWORD ?? '';
if (!password) {
  password = await promptHidden('Νέος κωδικός (τουλάχιστον 10 χαρακτήρες, λατινικό πληκτρολόγιο): ');
  const again = await promptHidden('Ξανά τον κωδικό: ');
  if (password !== again) fail('Οι κωδικοί δεν ταιριάζουν.');
}
if (password.length < 10) fail('Ο κωδικός πρέπει να έχει τουλάχιστον 10 χαρακτήρες.');

const url = process.env.DATABASE_URL;
if (!url) fail('Λείπει το DATABASE_URL (.env).');
const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  const rows = await sql`UPDATE users SET password_hash = ${await hash(password)} WHERE lower(email) = lower(${a.email}) RETURNING email`;
  if (!rows.length) fail(`Δεν υπάρχει λογαριασμός ${a.email}.`);
  console.log(`\n✓ Ο κωδικός του ${rows[0].email} άλλαξε. Σύνδεση: ${(process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/el/login\n`);
} finally {
  await sql.end();
}
