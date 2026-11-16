// Builds an upload-ready release package from your working copy:
//   npm run release   →   release/softifyos-YYYYMMDD-HHMM.tar.gz
// Includes every file git would track (committed or not), excludes .env, node_modules, builds and dev data.
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((f) => !f.startsWith('.claude/') && !f.startsWith('release/') && f !== '.env')
  .filter((f) => { try { return statSync(join(root, f)).isFile(); } catch { return false; } });

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
mkdirSync(join(root, 'release'), { recursive: true });
const out = join('release', `softifyos-${stamp}.tar.gz`);
const list = join(root, 'release', '.files');
writeFileSync(list, files.join('\n') + '\n');
execFileSync('tar', ['-czf', out, '-T', list], { cwd: root, stdio: 'inherit' });
rmSync(list);

const mb = (statSync(join(root, out)).size / 1024 / 1024).toFixed(2);
console.log(`\n✓ ${out}  (${files.length} αρχεία, ${mb} MB)\n`);
console.log('Ανέβασέ το στον server, π.χ.:');
console.log(`  scp ${out.replace(/\\/g, '/')} root@app.softify.gr:/root/\n`);
