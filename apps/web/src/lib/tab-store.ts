// Per-tab storage. Every in-app tab keeps its own page state (filters, active view, drafts…) under
// its own prefix, so two "Customers" tabs can have different filters and survive a reload.
// Pages use tabStore exactly like sessionStorage.

let currentTab = 'default';
const PREFIX = 'sos.tab.';

/** Set by the tabs provider before the active tab's page renders. */
export function setCurrentTab(id: string) { currentTab = id; }
export function getCurrentTab() { return currentTab; }

const k = (key: string, tab = currentTab) => `${PREFIX}${tab}.${key}`;

export const tabStore = {
  getItem(key: string): string | null {
    try { return localStorage.getItem(k(key)); } catch { return null; }
  },
  setItem(key: string, value: string) {
    try { localStorage.setItem(k(key), value); } catch { /* quota / private mode */ }
  },
  removeItem(key: string) {
    try { localStorage.removeItem(k(key)); } catch { /* ignore */ }
  },
};

/** Copy one tab's state to another (duplicate tab). */
export function copyTabState(from: string, to: string) {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(`${PREFIX}${from}.`)) localStorage.setItem(`${PREFIX}${to}.${key.slice(PREFIX.length + from.length + 1)}`, localStorage.getItem(key)!);
    }
  } catch { /* ignore */ }
}

/** Forget a closed tab's state. */
export function dropTabState(id: string) {
  try {
    const drop: string[] = [];
    for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key?.startsWith(`${PREFIX}${id}.`)) drop.push(key); }
    drop.forEach((key) => localStorage.removeItem(key));
  } catch { /* ignore */ }
}

/** Remove state of tabs that no longer exist (e.g. closed on another window). */
export function pruneTabState(alive: Set<string>) {
  try {
    const drop: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const id = key.slice(PREFIX.length).split('.')[0];
      if (!alive.has(id)) drop.push(key);
    }
    drop.forEach((key) => localStorage.removeItem(key));
  } catch { /* ignore */ }
}
