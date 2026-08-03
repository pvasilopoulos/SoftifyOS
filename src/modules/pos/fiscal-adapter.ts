/** Fiscal / ΦΗΜ adapter shell (Phase B). MOCK until device driver exists. */

export type FiscalReceiptRequest = {
  invoiceNumber: string;
  total: number;
  vatAmount: number;
  lines: Array<{ description: string; quantity: number; lineTotal: number; vatRate: number }>;
};

export type FiscalReceiptResult = {
  ok: boolean;
  fiscalId: string | null;
  signature: string | null;
  provider: string;
  raw: Record<string, unknown>;
  error?: string;
};

export interface FiscalAdapter {
  issueReceipt(req: FiscalReceiptRequest): Promise<FiscalReceiptResult>;
}

export const mockFiscalAdapter: FiscalAdapter = {
  async issueReceipt(req) {
    const fiscalId = `FHM-MOCK-${req.invoiceNumber.replace(/\W/g, "").slice(-12)}-${Date.now()
      .toString(36)
      .toUpperCase()}`;
    return {
      ok: true,
      fiscalId,
      signature: `SIG-${btoa(fiscalId).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 24)}`,
      provider: "MOCK",
      raw: {
        invoiceNumber: req.invoiceNumber,
        total: req.total,
        vatAmount: req.vatAmount,
        lineCount: req.lines.length,
        issuedAt: new Date().toISOString(),
      },
    };
  },
};

export function resolveFiscalAdapter(_provider?: string | null): FiscalAdapter {
  return mockFiscalAdapter;
}
