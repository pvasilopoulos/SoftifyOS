/** Card terminal provider adapters (Phase B). Live Viva/Worldline later. */

export type CardAuthRequest = {
  amount: number;
  currency?: string;
  terminalId: string;
  provider: string;
  invoiceNumber?: string | null;
};

export type CardAuthResult = {
  ok: boolean;
  provider: string;
  externalRef: string;
  authCode: string | null;
  status: "AUTHORIZED" | "CAPTURED" | "DECLINED" | "ERROR";
  raw: Record<string, unknown>;
  error?: string;
};

export interface CardProviderAdapter {
  authorize(req: CardAuthRequest): Promise<CardAuthResult>;
  voidPayment(externalRef: string): Promise<{ ok: boolean; raw: Record<string, unknown> }>;
}

function mockRef(prefix: string) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()}`;
}

export const mockCardAdapter: CardProviderAdapter = {
  async authorize(req) {
    if (req.amount <= 0) {
      return {
        ok: false,
        provider: "MOCK",
        externalRef: mockRef("MOCK-DECL"),
        authCode: null,
        status: "DECLINED",
        raw: { reason: "amount_invalid" },
        error: "Μη έγκυρο ποσό",
      };
    }
    const externalRef = mockRef("MOCK");
    return {
      ok: true,
      provider: "MOCK",
      externalRef,
      authCode: String(Math.floor(100000 + Math.random() * 900000)),
      status: "CAPTURED",
      raw: {
        terminalId: req.terminalId,
        amount: req.amount,
        currency: req.currency ?? "EUR",
        invoiceNumber: req.invoiceNumber ?? null,
        capturedAt: new Date().toISOString(),
      },
    };
  },
  async voidPayment(externalRef) {
    return {
      ok: true,
      raw: { voided: externalRef, at: new Date().toISOString(), provider: "MOCK" },
    };
  },
};

/** Resolve adapter by PosTerminal.provider — live providers throw until wired. */
export function resolveCardAdapter(provider: string): CardProviderAdapter {
  const p = provider.toUpperCase();
  if (p === "MOCK" || p === "OTHER") return mockCardAdapter;
  if (p === "VIVA" || p === "WORLDLINE") {
    return {
      async authorize() {
        return {
          ok: false,
          provider: p,
          externalRef: "",
          authCode: null,
          status: "ERROR",
          raw: {},
          error: `${p} live adapter δεν έχει συνδεθεί ακόμα — χρησιμοποίησε MOCK`,
        };
      },
      async voidPayment() {
        return { ok: false, raw: { error: "not_implemented" } };
      },
    };
  }
  return mockCardAdapter;
}
