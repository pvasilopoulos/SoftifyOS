// AI client helpers: status (what is available to this user), streamed chat, action types.
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export type AiFeature = 'copilot' | 'voice' | 'summary' | 'reports' | 'offer_draft' | 'import';
export type AiStatus = { configured: boolean; enabled: boolean; allowed: boolean; features: Record<AiFeature, boolean>; budget_left: boolean };
export type AiAction = {
  id: string; kind: 'task' | 'activity' | 'offer_draft' | 'save_report'; status: 'pending' | 'done' | 'cancelled' | 'failed';
  payload: Record<string, unknown>; summary: Record<string, unknown>; result?: Record<string, unknown> | null;
};
export type ChatEvent =
  | { type: 'start'; conversation_id: string }
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; label: string }
  | { type: 'action'; action: AiAction }
  | { type: 'done'; conversation_id: string }
  | { type: 'error'; error: string };

export function useAiStatus() {
  return useQuery({ queryKey: ['ai-status'], queryFn: () => api<AiStatus>('/ai/status'), staleTime: 60_000 });
}
/** true when the feature can be used right now (configured, enabled, allowed, in budget). */
export function useAi(feature: AiFeature) {
  const { data } = useAiStatus();
  return !!data?.features[feature];
}

/** POST /ai/chat and read the Server-Sent Events. Throws { code } on an HTTP error before the stream starts. */
export async function streamChat(body: unknown, onEvent: (e: ChatEvent) => void, signal?: AbortSignal) {
  const res = await fetch('/api/ai/chat', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    const b = await res.json().catch(() => ({}));
    throw Object.assign(new Error(b.error ?? 'error'), { code: b.error ?? 'error' });
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (line) { try { onEvent(JSON.parse(line.slice(6)) as ChatEvent); } catch { /* ignore partial */ } }
    }
  }
}

/** Error code → message key in the "ai" namespace. */
export const aiErrorKey = (code: string) =>
  (['ai_not_configured', 'ai_disabled', 'feature_disabled', 'budget_exceeded', 'forbidden', 'ai_rate_limited', 'ai_auth', 'refused', 'too_long'] as const).includes(code as never)
    ? `err_${code}` : 'err_generic';
