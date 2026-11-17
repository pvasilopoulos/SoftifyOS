// Sends browser errors to the API (grouped and alerted there). At most 5 per page load, never throws.
let sent = 0;
export function reportError(e: unknown, extra?: { digest?: string }) {
  if (typeof window === 'undefined' || sent >= 5) return;
  sent++;
  const err = e instanceof Error ? e : new Error(typeof e === 'string' ? e : 'Unknown error');
  const body = JSON.stringify({ message: err.message, stack: err.stack, url: location.pathname, digest: extra?.digest });
  try {
    if (!navigator.sendBeacon?.('/api/client-errors', new Blob([body], { type: 'application/json' }))) {
      fetch('/api/client-errors', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
    }
  } catch { /* ignore */ }
}

export function installErrorReporting() {
  const onError = (ev: ErrorEvent) => {
    // Ignore noise from extensions and cross-origin scripts
    if (!ev.error || /^chrome-extension:|^moz-extension:/.test(ev.filename ?? '')) return;
    reportError(ev.error);
  };
  const onRejection = (ev: PromiseRejectionEvent) => {
    const r = ev.reason;
    if (r && typeof r === 'object' && 'status' in r) return;   // ApiError: handled by the screens
    reportError(r);
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); };
}
