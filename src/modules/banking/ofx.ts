export type ParsedBankLine = {
  bookedAt: string;
  amount: number;
  description: string;
  reference: string | null;
  counterparty: string | null;
};

/** Minimal OFX / QFX STMTTRN parser (no external dependency). */
export function parseOfxTransactions(raw: string): ParsedBankLine[] {
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  const out: ParsedBankLine[] = [];

  for (const block of blocks) {
    const body = block.split(/<\/STMTTRN>/i)[0] ?? block;
    const amountRaw = tagValue(body, "TRNAMT");
    const dateRaw =
      tagValue(body, "DTPOSTED") ||
      tagValue(body, "DTUSER") ||
      tagValue(body, "DTAVAIL");
    if (!amountRaw || !dateRaw) continue;
    const amount = Number(amountRaw.replace(",", "."));
    if (!Number.isFinite(amount)) continue;
    const bookedAt = ofxDateToIso(dateRaw);
    if (!bookedAt) continue;
    const memo = tagValue(body, "MEMO") || tagValue(body, "NAME") || "Κίνηση OFX";
    const name = tagValue(body, "NAME");
    const fitid = tagValue(body, "FITID");
    const checknum = tagValue(body, "CHECKNUM");
    const reference = fitid || checknum || null;
    out.push({
      bookedAt,
      amount,
      description: memo.slice(0, 300),
      reference: reference ? reference.slice(0, 120) : null,
      counterparty: name ? name.slice(0, 200) : null,
    });
  }

  return out;
}

function tagValue(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([^\\n<]*)`, "i");
  const m = block.match(re);
  if (!m) return null;
  return m[1]!.trim() || null;
}

function ofxDateToIso(raw: string): string | null {
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length < 8) return null;
  const y = digits.slice(0, 4);
  const mo = digits.slice(4, 6);
  const d = digits.slice(6, 8);
  const hh = digits.slice(8, 10) || "12";
  const mm = digits.slice(10, 12) || "00";
  const ss = digits.slice(12, 14) || "00";
  const iso = `${y}-${mo}-${d}T${hh}:${mm}:${ss}.000Z`;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}
