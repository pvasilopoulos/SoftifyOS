/**
 * E-invoicing πάροχος adapter shell (Phase A2).
 * When integrationsJson.eInvoicingProvider is set (and not NONE/AADE),
 * myDATA processing can route through a certified provider instead of direct AADE ERP API.
 *
 * Live Novaon/Impact HTTP is not wired yet — sandbox MOCK accepts; live fails closed.
 */

export type EInvoicingProviderId = "NONE" | "AADE" | "MOCK" | "NOVAON" | "IMPACT";

export type EInvoicingSendRequest = {
  invoicesDocXml: string;
  entityType: string;
  entityId: string;
  entityNumber?: string | null;
  env: "sandbox" | "prod";
  credentials?: { apiKey?: string | null; endpoint?: string | null };
};

export type EInvoicingSendResult = {
  ok: boolean;
  provider: EInvoicingProviderId;
  mark: string | null;
  uid: string | null;
  errors: Array<{ code?: string; message: string }>;
  raw: Record<string, unknown>;
};

export interface EInvoicingAdapter {
  id: EInvoicingProviderId;
  send(req: EInvoicingSendRequest): Promise<EInvoicingSendResult>;
}

function mockMark(prefix: string, entityId: string) {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `${prefix}-${ymd}-${entityId.slice(-8).toUpperCase()}`;
}

export const mockEInvoicingAdapter: EInvoicingAdapter = {
  id: "MOCK",
  async send(req) {
    if (!req.invoicesDocXml.trim()) {
      return {
        ok: false,
        provider: "MOCK",
        mark: null,
        uid: null,
        errors: [{ code: "XML-001", message: "Κενό InvoicesDoc XML" }],
        raw: {},
      };
    }
    const mark = mockMark("MARK-PROV", req.entityId);
    const uid = mockMark("UID-PROV", req.entityId);
    return {
      ok: true,
      provider: "MOCK",
      mark,
      uid,
      errors: [],
      raw: {
        mode: "sandbox",
        entityType: req.entityType,
        entityNumber: req.entityNumber ?? null,
        note: "Πάροχος MOCK sandbox — όχι πραγματική διαβίβαση",
        at: new Date().toISOString(),
      },
    };
  },
};

function liveNotWired(id: "NOVAON" | "IMPACT"): EInvoicingAdapter {
  return {
    id,
    async send() {
      return {
        ok: false,
        provider: id,
        mark: null,
        uid: null,
        errors: [
          {
            code: "PROV-001",
            message: `${id} live adapter δεν έχει συνδεθεί — βάλε MOCK ή AADE ERP API`,
          },
        ],
        raw: { failClosed: true },
      };
    },
  };
}

export function readEInvoicingProvider(
  integrationsJson: unknown,
): EInvoicingProviderId {
  if (
    !integrationsJson ||
    typeof integrationsJson !== "object" ||
    Array.isArray(integrationsJson)
  ) {
    return "NONE";
  }
  const raw = (integrationsJson as Record<string, unknown>).eInvoicingProvider;
  if (typeof raw !== "string") return "NONE";
  const p = raw.toUpperCase();
  if (
    p === "NONE" ||
    p === "AADE" ||
    p === "MOCK" ||
    p === "NOVAON" ||
    p === "IMPACT"
  ) {
    return p;
  }
  return "NONE";
}

export function resolveEInvoicingAdapter(
  provider: EInvoicingProviderId,
): EInvoicingAdapter | null {
  if (provider === "NONE" || provider === "AADE") return null;
  if (provider === "MOCK") return mockEInvoicingAdapter;
  if (provider === "NOVAON" || provider === "IMPACT") {
    return liveNotWired(provider);
  }
  return null;
}
