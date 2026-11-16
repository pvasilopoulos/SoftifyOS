// Client-side "smart" matching: accent/case-insensitive and Greek ⇄ Latin (greeklish) aware.
// Both the text and the query are reduced to the same phonetic key, so "athina", "a8hna", "ΑΘΗΝΑ" and "Αθήνα"
// all match "Αθήνα"; "xania"/"chania"/"hania" match "Χανιά"; "thessaloniki"/"8essaloniki" match "Θεσσαλονίκη".

/** lowercase, no accents/diacritics, final sigma → sigma */
export const fold = (x: string) => x.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/ς/g, 'σ');

// Greek → Latin (digraphs first)
const GREEK_PAIRS: [string, string][] = [
  ['ου', 'ou'], ['ευ', 'ev'], ['αυ', 'av'], ['αι', 'e'], ['ει', 'i'], ['οι', 'i'], ['υι', 'i'],
  ['μπ', 'b'], ['ντ', 'd'], ['γκ', 'g'], ['γγ', 'g'], ['τσ', 'ts'], ['τζ', 'tz'],
];
const GREEK: Record<string, string> = {
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: '8', ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x',
  ο: 'o', π: 'p', ρ: 'r', σ: 's', τ: 't', υ: 'i', φ: 'f', χ: 'x', ψ: 'ps', ω: 'o',
};
// Common greeklish spellings → the same canonical letters
const LATIN_PAIRS: [string, string][] = [
  ['th', '8'], ['ch', 'x'], ['kh', 'x'], ['ks', 'x'], ['ph', 'f'], ['ps', 'ps'],
  ['eu', 'ev'], ['ef', 'ev'], ['au', 'av'], ['af', 'av'],
  ['ou', 'u'], ['ai', 'e'], ['ei', 'i'], ['oi', 'i'], ['mp', 'b'], ['nt', 'd'], ['gk', 'g'], ['gg', 'g'],
];
const LATIN: Record<string, string> = { w: 'o', y: 'i', h: 'i', b: 'v', c: 'k', q: 'k', u: 'u' };

/** Phonetic key used for matching (not for display). hAs = how a lone Latin 'h' is read (η or χ). */
export function phonetic(text: string, hAs: 'i' | 'x' = 'i') {
  let s = fold(text);
  for (const [g, l] of GREEK_PAIRS) s = s.replaceAll(g, l);
  s = s.replace(/[α-ω]/g, (c) => GREEK[c] ?? c);
  for (const [a, b] of LATIN_PAIRS) s = s.replaceAll(a, b);
  s = s.replace(/[a-z]/g, (c) => (c === 'h' ? hAs : LATIN[c] ?? c));
  return s.replace(/(.)\1+/g, '$1'); // double letters: σσ/ss, λλ/ll…
}

/**
 * Match quality of `text` for `query`: 0 = starts with it, 1 = a word starts with it, 2 = contains every word,
 * null = no match. Tries the plain (folded) form first, then the phonetic (greeklish) form.
 */
export function matchRank(text: string, query: string): number | null {
  const q = fold(query.trim());
  if (!q) return 0;
  const tryForm = (t: string, words: string[]) => {
    if (t.startsWith(words.join(' '))) return 0;
    if (!words.every((w) => t.includes(w))) return null;
    return t.split(/[\s,.·()/&-]+/).some((p) => p.startsWith(words[0])) ? 1 : 2;
  };
  const plain = tryForm(fold(text), q.split(/\s+/).filter(Boolean));
  if (plain !== null) return plain;
  // A lone Latin 'h' is either η ("ira") or χ ("hania"): try both readings
  const t = phonetic(text);
  for (const hAs of ['i', 'x'] as const) {
    const ph = tryForm(t, phonetic(query, hAs).split(/\s+/).filter(Boolean));
    if (ph !== null) return ph + 0.5; // phonetic matches rank just after exact ones
  }
  return null;
}
