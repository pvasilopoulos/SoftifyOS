// Next "standalone" output does not include static assets: copy them next to server.js
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, '.next/standalone/apps/web');
if (!existsSync(out)) throw new Error(`standalone output not found at ${out}`);
cpSync(resolve(root, '.next/static'), resolve(out, '.next/static'), { recursive: true });
cpSync(resolve(root, 'public'), resolve(out, 'public'), { recursive: true });
console.log('Copied static assets into', out);
