'use client';
// Phone-first capture for Documents: "Photo" opens the camera directly, "Record" records a voice note in the
// browser (MediaRecorder) and saves it as a document. Recording keeps the screen awake and stops by itself
// before the file would exceed the upload limit.
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useLocale, useTranslations } from 'next-intl';
import { Camera, Mic, Pause, Play, RotateCcw, Save, Square } from 'lucide-react';
import { Dialog } from './customer-dialogs';
import { appConfirm } from './confirm';

/** Best format the browser can record: Opus in WebM (Chrome, Android, Firefox) or AAC in MP4 (iPhone / Safari). */
function pickFormat() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const [mime, ext] of [['audio/webm;codecs=opus', 'webm'], ['audio/webm', 'webm'], ['audio/mp4', 'm4a'], ['audio/ogg;codecs=opus', 'ogg']] as const) {
    if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  }
  return null;
}
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function CaptureButtons({ onFiles, disabled, maxBytes, compact }: { onFiles: (f: FileList | File[]) => void; disabled?: boolean; maxBytes: number; compact?: boolean }) {
  const t = useTranslations('docs');
  const cam = useRef<HTMLInputElement>(null);
  const [rec, setRec] = useState(false);
  const btn = 'flex h-10 items-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-sm font-medium disabled:opacity-60';
  return (
    <>
      <button type="button" disabled={disabled} onClick={() => cam.current?.click()} className={btn} title={t('photo')} aria-label={t('photo')}>
        <Camera size={16} /> <span className={clsx(compact && 'hidden sm:inline')}>{t('photo')}</span>
      </button>
      <button type="button" disabled={disabled} onClick={() => setRec(true)} className={btn} title={t('record')} aria-label={t('record')}>
        <Mic size={16} /> <span className={clsx(compact && 'hidden sm:inline')}>{t('record')}</span>
      </button>
      {/* capture → the phone opens the camera; on a computer it is a normal image picker */}
      <input ref={cam} type="file" accept="image/*" capture="environment" multiple hidden
        onChange={(e) => { if (e.target.files?.length) onFiles(e.target.files); e.target.value = ''; }} />
      {rec && <VoiceRecorder maxBytes={maxBytes} onClose={() => setRec(false)} onSave={(f) => { onFiles([f]); setRec(false); }} />}
    </>
  );
}

type State = 'idle' | 'recording' | 'paused' | 'done' | 'error';

export function VoiceRecorder({ onSave, onClose, maxBytes }: { onSave: (f: File) => void; onClose: () => void; maxBytes: number }) {
  const t = useTranslations('docs');
  const locale = useLocale();
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState('');
  const [secs, setSecs] = useState(0);
  const [level, setLevel] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const stamp = () => new Date().toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }).replace(/[/:]/g, '-').replace(/,/g, '');
  const [name, setName] = useState(() => `${t('recordingName')} ${stamp()}`);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const bytes = useRef(0);
  const stream = useRef<MediaStream | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const wake = useRef<{ release: () => Promise<void> } | null>(null);
  const fmt = useRef(pickFormat());
  const blob = useRef<Blob | null>(null);

  const cleanup = () => {
    stream.current?.getTracks().forEach((x) => x.stop());
    stream.current = null;
    audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;
    wake.current?.release().catch(() => {});
    wake.current = null;
  };
  useEffect(() => () => { cleanup(); if (url) URL.revokeObjectURL(url); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Timer while recording
  useEffect(() => {
    if (state !== 'recording') return;
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [state]);

  const start = async () => {
    setError('');
    if (!fmt.current || !navigator.mediaDevices?.getUserMedia) { setState('error'); setError(t('recUnsupported')); return; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      stream.current = s;
      // Input level meter
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      audioCtx.current = ctx;
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      ctx.createMediaStreamSource(s).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const tick = () => {
        if (!audioCtx.current) return;
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(1, peak / 64));
        requestAnimationFrame(tick);
      };
      tick();
      // Keep the phone screen on while recording (where supported)
      try { wake.current = await (navigator as unknown as { wakeLock?: { request: (k: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') ?? null; } catch { /* not available */ }

      chunks.current = []; bytes.current = 0;
      const r = new MediaRecorder(s, { mimeType: fmt.current.mime, audioBitsPerSecond: 64000 });
      r.ondataavailable = (e) => {
        if (!e.data.size) return;
        chunks.current.push(e.data);
        bytes.current += e.data.size;
        if (bytes.current > maxBytes * 0.95 && r.state !== 'inactive') r.stop();   // stop before the upload limit
      };
      r.onstop = () => {
        const b = new Blob(chunks.current, { type: fmt.current!.mime.split(';')[0] });
        blob.current = b;
        setUrl((u) => { if (u) URL.revokeObjectURL(u); return URL.createObjectURL(b); });
        setState('done');
        cleanup();
      };
      rec.current = r;
      r.start(1000);
      setSecs(0);
      setState('recording');
    } catch (e) {
      cleanup();
      setState('error');
      setError((e as DOMException)?.name === 'NotAllowedError' ? t('recDenied') : t('recNoMic'));
    }
  };
  const pause = () => { rec.current?.pause(); setState('paused'); };
  const resume = () => { rec.current?.resume(); setState('recording'); };
  const stop = () => { if (rec.current && rec.current.state !== 'inactive') rec.current.stop(); };
  const again = () => { blob.current = null; if (url) URL.revokeObjectURL(url); setUrl(null); setSecs(0); setState('idle'); };
  const save = () => {
    if (!blob.current) return;
    const clean = (name.trim() || t('recordingName')).replace(/[\\/:*?"<>|]+/g, '-').slice(0, 150);
    onSave(new File([blob.current], `${clean}.${fmt.current!.ext}`, { type: blob.current.type }));
  };
  const close = async () => {
    if ((state === 'recording' || state === 'paused' || state === 'done') && !(await appConfirm(t('recDiscard'), { danger: true }))) return;
    if (rec.current && rec.current.state !== 'inactive') { rec.current.onstop = null; rec.current.stop(); }
    cleanup();
    onClose();
  };

  const live = state === 'recording' || state === 'paused';
  return (
    <Dialog title={t('record')} onClose={close}>
      <div className="flex flex-col items-center gap-5 py-2">
        <div className={clsx('tabular text-5xl font-bold', state === 'recording' ? 'text-danger' : 'text-text')} aria-live="polite">{mmss(secs)}</div>
        {/* level meter */}
        <div className="flex h-10 items-end gap-1" aria-hidden>
          {Array.from({ length: 24 }).map((_, i) => {
            const h = live && state === 'recording' ? Math.max(0.08, Math.min(1, level * (0.6 + 0.4 * Math.sin((i + secs) * 1.3) ** 2))) : 0.08;
            return <span key={i} className={clsx('w-1.5 rounded-full transition-all duration-100', state === 'recording' ? 'bg-danger' : 'bg-border')} style={{ height: `${h * 100}%` }} />;
          })}
        </div>

        {state === 'idle' || state === 'error' ? (
          <>
            <button type="button" onClick={start} aria-label={t('recStart')}
              className="grid h-20 w-20 place-items-center rounded-full bg-danger text-white shadow-lg shadow-danger/30 transition active:scale-95">
              <Mic size={34} />
            </button>
            <p className="text-center text-sm text-muted">{error || t('recHint')}</p>
          </>
        ) : live ? (
          <div className="flex items-center gap-4">
            <button type="button" onClick={state === 'recording' ? pause : resume} aria-label={state === 'recording' ? t('recPause') : t('recResume')}
              className="grid h-14 w-14 place-items-center rounded-full border border-border bg-surface">
              {state === 'recording' ? <Pause size={22} /> : <Play size={22} />}
            </button>
            <button type="button" onClick={stop} aria-label={t('recStop')}
              className="grid h-20 w-20 place-items-center rounded-full bg-danger text-white shadow-lg shadow-danger/30 transition active:scale-95">
              <Square size={28} fill="currentColor" />
            </button>
          </div>
        ) : (
          <div className="w-full space-y-3">
            {url && <audio controls src={url} className="w-full" />}
            <label className="block text-sm">
              <span className="mb-1 block text-muted">{t('recName')}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={150}
                className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 outline-none focus:border-primary" />
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={again} className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2.5 text-sm font-medium"><RotateCcw size={15} /> {t('recAgain')}</button>
              <span className="flex-1" />
              <button type="button" onClick={save} className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white"><Save size={15} /> {t('recSave')}</button>
            </div>
          </div>
        )}
        {state === 'paused' && <p className="text-sm text-muted">{t('recPaused')}</p>}
      </div>
    </Dialog>
  );
}
