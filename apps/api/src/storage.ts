// File storage on local disk (UPLOAD_DIR): streamed writes with a size cap, SHA-256, and content sniffing —
// only known safe types are accepted and the declared extension must match the bytes.
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { env } from './env.js';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const root = () => path.resolve(env.uploadDir);
const fileOf = (key: string) => {
  const p = path.resolve(root(), key);
  if (!p.startsWith(root() + path.sep)) throw new Error('bad_key');
  return p;
};

type Kind = { mime: string; sig?: (h: Buffer) => boolean; text?: boolean; inline?: boolean };
const pk = (h: Buffer) => h[0] === 0x50 && h[1] === 0x4b && (h[2] === 0x03 || h[2] === 0x05) ;
const ole = (h: Buffer) => h.subarray(0, 4).toString('hex') === 'd0cf11e0';
const TYPES: Record<string, Kind> = {
  pdf: { mime: 'application/pdf', sig: (h) => h.subarray(0, 5).toString('latin1') === '%PDF-', inline: true },
  png: { mime: 'image/png', sig: (h) => h.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', inline: true },
  jpg: { mime: 'image/jpeg', sig: (h) => h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff, inline: true },
  jpeg: { mime: 'image/jpeg', sig: (h) => h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff, inline: true },
  webp: { mime: 'image/webp', sig: (h) => h.subarray(0, 4).toString('latin1') === 'RIFF' && h.subarray(8, 12).toString('latin1') === 'WEBP', inline: true },
  gif: { mime: 'image/gif', sig: (h) => h.subarray(0, 4).toString('latin1') === 'GIF8', inline: true },
  heic: { mime: 'image/heic', sig: (h) => h.subarray(4, 8).toString('latin1') === 'ftyp' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sig: pk },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sig: pk },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', sig: pk },
  odt: { mime: 'application/vnd.oasis.opendocument.text', sig: pk },
  ods: { mime: 'application/vnd.oasis.opendocument.spreadsheet', sig: pk },
  odp: { mime: 'application/vnd.oasis.opendocument.presentation', sig: pk },
  zip: { mime: 'application/zip', sig: pk },
  doc: { mime: 'application/msword', sig: ole },
  xls: { mime: 'application/vnd.ms-excel', sig: ole },
  ppt: { mime: 'application/vnd.ms-powerpoint', sig: ole },
  msg: { mime: 'application/vnd.ms-outlook', sig: ole },
  txt: { mime: 'text/plain; charset=utf-8', text: true },
  csv: { mime: 'text/csv; charset=utf-8', text: true },
  md: { mime: 'text/markdown; charset=utf-8', text: true },
  json: { mime: 'application/json', text: true },
  xml: { mime: 'application/xml', text: true },
  eml: { mime: 'message/rfc822', text: true },
  mp4: { mime: 'video/mp4', sig: (h) => h.subarray(4, 8).toString('latin1') === 'ftyp' },
  // Voice recordings (in-app recorder: webm on Chrome/Android, m4a on iPhone) and common audio files
  webm: { mime: 'audio/webm', sig: (h) => h.subarray(0, 4).toString('hex') === '1a45dfa3', inline: true },
  m4a: { mime: 'audio/mp4', sig: (h) => h.subarray(4, 8).toString('latin1') === 'ftyp', inline: true },
  ogg: { mime: 'audio/ogg', sig: (h) => h.subarray(0, 4).toString('latin1') === 'OggS', inline: true },
  mp3: { mime: 'audio/mpeg', sig: (h) => h.subarray(0, 3).toString('latin1') === 'ID3' || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0), inline: true },
  wav: { mime: 'audio/wav', sig: (h) => h.subarray(0, 4).toString('latin1') === 'RIFF' && h.subarray(8, 12).toString('latin1') === 'WAVE', inline: true },
};
export const ALLOWED_EXT = Object.keys(TYPES);
export const extOf = (name: string) => (path.extname(name).slice(1) || '').toLowerCase();
/** Shown in the browser (images, PDF) instead of downloaded. */
export const isInline = (ext: string) => !!TYPES[ext]?.inline;

/** Checks the first bytes against the extension. Returns the MIME type or null. */
export function sniff(ext: string, head: Buffer) {
  const k = TYPES[ext];
  if (!k) return null;
  if (k.text) return head.includes(0) ? null : k.mime;   // binary data in a "text" file
  return k.sig && k.sig(head) ? k.mime : null;
}

export class UploadError extends Error { constructor(public code: 'too_large' | 'empty' | 'type_not_allowed' | 'content_mismatch') { super(code); } }

/** Streams the upload to disk (temp file → final key). Rejects unknown types, mismatched content, and files over the cap. */
export async function saveUpload(tenantId: string, name: string, body: Readable, maxBytes = MAX_FILE_BYTES) {
  const ext = extOf(name);
  if (!TYPES[ext]) { body.resume(); throw new UploadError('type_not_allowed'); }
  const d = new Date();
  const key = `${tenantId}/${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${randomUUID()}`;
  const final = fileOf(key);
  const tmp = `${final}.part`;
  await mkdir(path.dirname(final), { recursive: true });
  const hash = createHash('sha256');
  let size = 0;
  let head = Buffer.alloc(0);
  const out = createWriteStream(tmp);
  try {
    await new Promise<void>((resolve, reject) => {
      let over = false;
      body.on('data', (chunk: Buffer) => {
        size += chunk.length;
        // Over the cap: stop writing but read the rest (up to a limit) so the client gets a clean 413
        if (size > maxBytes) {
          if (!over) { over = true; out.destroy(); }
          if (size > maxBytes * 2 + 1_048_576) body.destroy();
          return;
        }
        if (head.length < 4096) head = Buffer.concat([head, chunk.subarray(0, 4096 - head.length)]);
        hash.update(chunk);
        if (!out.write(chunk)) { body.pause(); out.once('drain', () => body.resume()); }
      });
      body.on('end', () => (over ? reject(new UploadError('too_large')) : out.end(() => resolve())));
      body.on('close', () => { if (over) reject(new UploadError('too_large')); });
      body.on('error', reject);
      out.on('error', (e) => { if (!over) reject(e); });
    });
    if (!size) throw new UploadError('empty');
    const mime = sniff(ext, head);
    if (!mime) throw new UploadError('content_mismatch');
    await rename(tmp, final);
    return { key, size, sha256: hash.digest('hex'), mime, ext };
  } catch (e) {
    out.destroy();
    await rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

export async function openFile(key: string) {
  const p = fileOf(key);
  const s = await stat(p);
  return { stream: createReadStream(p), size: s.size };
}
export async function removeFile(key: string) {
  await rm(fileOf(key), { force: true });
}
