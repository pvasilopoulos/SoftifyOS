export type MyDataEnv = "simulator" | "test" | "prod";

export type WebhookEventKey =
  | "invoice.issued"
  | "invoice.cancelled"
  | "payment.received"
  | "order.created"
  | "mydata.accepted"
  | "mydata.rejected"
  | "inventory.adjusted";

export const WEBHOOK_EVENTS: Array<{
  key: WebhookEventKey;
  label: string;
}> = [
  { key: "invoice.issued", label: "Έκδοση τιμολογίου" },
  { key: "invoice.cancelled", label: "Ακύρωση τιμολογίου" },
  { key: "payment.received", label: "Είσπραξη" },
  { key: "order.created", label: "Νέα παραγγελία" },
  { key: "mydata.accepted", label: "myDATA αποδοχή" },
  { key: "mydata.rejected", label: "myDATA απόρριψη" },
  { key: "inventory.adjusted", label: "Απογραφή / κίνηση" },
];

export type IntegrationApiToken = {
  id: string;
  name: string;
  /** Visible prefix e.g. sof_live_ab12 */
  prefix: string;
  /** sha256 hex of full token */
  hash: string;
  createdAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
};

export type IntegrationTestResult = {
  at: string;
  ok: boolean;
  status?: number;
  message: string;
  latencyMs?: number;
};

export type IntegrationsConfig = {
  webhookUrl?: string | null;
  webhookSecretHint?: string | null;
  /** HMAC secret for outbound webhooks (stored server-side only) */
  webhookSecret?: string | null;
  webhookEvents?: WebhookEventKey[];
  webhookEnabled?: boolean;
  skroutzEnabled?: boolean;
  skroutzShopId?: string | null;
  marketplaceNotes?: string | null;
  myDataEnv?: MyDataEnv;
  myDataUserId?: string | null;
  myDataSubscriptionKey?: string | null;
  /**
   * Certified e-invoicing πάροχος channel.
   * NONE/AADE = direct AADE ERP API (default).
   * MOCK = sandbox provider. NOVAON/IMPACT = live (fail-closed until wired).
   */
  eInvoicingProvider?: "NONE" | "AADE" | "MOCK" | "NOVAON" | "IMPACT" | null;
  notes?: string | null;
  apiTokens?: IntegrationApiToken[];
  lastWebhookTest?: IntegrationTestResult | null;
  lastMyDataTest?: IntegrationTestResult | null;
  erganiEnv?: "simulator" | "test" | "prod";
};

export function asIntegrationsConfig(value: unknown): IntegrationsConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as IntegrationsConfig;
}

export function maskSecret(value: string | null | undefined) {
  if (!value) return "";
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
