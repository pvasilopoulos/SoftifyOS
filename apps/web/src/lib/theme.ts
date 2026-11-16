export type Theme = 'light' | 'dark' | 'system';

export function getTheme(): Theme {
  try { return (localStorage.getItem('theme') as Theme) || 'system'; } catch { return 'system'; }
}

export function applyTheme(v: Theme) {
  try { localStorage.setItem('theme', v); } catch {}
  const dark = v === 'dark' || (v === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  window.dispatchEvent(new CustomEvent('themechange', { detail: v }));
}
