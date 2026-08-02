/** Client-safe QR helpers για ψηφιακή κάρτα εργασίας */

export function workCardQrPayload(qrToken: string) {
  return `SOFTIFYOS:WC:${qrToken}`;
}

export function parseWorkCardQr(raw: string): string {
  const t = raw.trim();
  const m = /^SOFTIFYOS:WC:([A-Za-z0-9_-]+)$/i.exec(t);
  if (m) return m[1]!;
  return t;
}
