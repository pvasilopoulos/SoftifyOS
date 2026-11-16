'use client';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { registerSW } from '@/lib/push';

type Toast = { id: number; title: string; body?: string; url?: string };
const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

const LiveCtx = createContext(false);
export const useLive = () => useContext(LiveCtx);

/** Subscribes to the SSE stream: refreshes affected queries and shows in-app toasts instantly. */
function LiveBridge({ onToast, onState }: { onToast: (t: Omit<Toast, 'id'>) => void; onState: (s: boolean) => void }) {
  const qc = useQueryClient();
  useEffect(() => {
    // No live stream on the login page or the public (not signed-in) customer pages
    if (/\/login\/?$|^\/(el|en)\/p\//.test(location.pathname)) return;
    const es = new EventSource('/api/stream');
    es.addEventListener('ready', () => onState(true));
    es.onerror = () => onState(false);
    es.addEventListener('notification', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      onToast(d);
      qc.invalidateQueries({ queryKey: ['notifications'] });
    });
    es.addEventListener('offer.updated', () => {
      qc.invalidateQueries({ queryKey: ['offers'] });
      qc.invalidateQueries({ queryKey: ['offer'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    });
    es.addEventListener('customer.created', () => qc.invalidateQueries({ queryKey: ['customers'] }));
    return () => es.close();
  }, [qc, onToast, onState]);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1 } },
  }));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [live, setLive] = useState(false);
  const [push] = useState(() => (t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((x) => [...x, { ...t, id }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 5000);
  });

  useEffect(() => { registerSW().catch(() => {}); }, []);

  return (
    <QueryClientProvider client={qc}>
      <ToastCtx.Provider value={push}>
        <LiveCtx.Provider value={live}>
          <LiveBridge onToast={push} onState={setLive} />
          {children}
          <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-4 safe-top">
            {toasts.map((t) => (
              <a key={t.id} href={t.url ?? '#'} className="card pointer-events-auto w-full max-w-sm px-4 py-3">
                <div className="text-sm font-semibold">{t.title}</div>
                {t.body && <div className="text-sm text-muted">{t.body}</div>}
              </a>
            ))}
          </div>
        </LiveCtx.Provider>
      </ToastCtx.Provider>
    </QueryClientProvider>
  );
}
