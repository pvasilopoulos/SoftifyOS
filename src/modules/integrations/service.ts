import { createHash, createHmac, randomBytes } from "crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { myDataEndpoint } from "@/modules/mydata/client";
import { readMyDataConfig } from "@/modules/mydata/payload";
import {
  asIntegrationsConfig,
  type IntegrationApiToken,
  type IntegrationTestResult,
  type IntegrationsConfig,
  type WebhookEventKey,
  WEBHOOK_EVENTS,
} from "./types";

type Db = PrismaClient | Prisma.TransactionClient;

export async function loadIntegrationsConfig(
  db: Db,
  tenantId: string,
): Promise<IntegrationsConfig> {
  const settings = await db.tenantSettings.findUnique({
    where: { tenantId },
    select: { integrationsJson: true },
  });
  return asIntegrationsConfig(settings?.integrationsJson);
}

export async function saveIntegrationsConfig(
  db: Db,
  tenantId: string,
  next: IntegrationsConfig,
) {
  await db.tenantSettings.upsert({
    where: { tenantId },
    create: { tenantId, integrationsJson: next as Prisma.InputJsonValue },
    update: { integrationsJson: next as Prisma.InputJsonValue },
  });
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createApiTokenValue() {
  const raw = randomBytes(24).toString("base64url");
  const token = `sof_live_${raw}`;
  const prefix = token.slice(0, 16);
  return { token, prefix, hash: hashToken(token) };
}

export function createWebhookSecret() {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

export async function testWebhookDelivery(
  config: IntegrationsConfig,
): Promise<IntegrationTestResult> {
  const started = Date.now();
  const url = config.webhookUrl?.trim();
  if (!url) {
    return {
      at: new Date().toISOString(),
      ok: false,
      message: "Δεν έχει οριστεί Webhook URL",
    };
  }

  const payload = {
    id: `evt_test_${Date.now()}`,
    type: "softifyos.ping",
    createdAt: new Date().toISOString(),
    data: {
      source: "SoftifyOS",
      message: "Integration connectivity test",
      events: config.webhookEvents ?? WEBHOOK_EVENTS.map((e) => e.key),
    },
  };
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "SoftifyOS-Integrations/1.0",
    "X-Softify-Event": "softifyos.ping",
    "X-Softify-Delivery": payload.id,
  };
  if (config.webhookSecret) {
    const sig = createHmac("sha256", config.webhookSecret)
      .update(body)
      .digest("hex");
    headers["X-Softify-Signature"] = `sha256=${sig}`;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const ok = res.status >= 200 && res.status < 300;
    return {
      at: new Date().toISOString(),
      ok,
      status: res.status,
      latencyMs: Date.now() - started,
      message: ok
        ? `Webhook OK · HTTP ${res.status}`
        : `Webhook απάντησε HTTP ${res.status}`,
    };
  } catch (error) {
    return {
      at: new Date().toISOString(),
      ok: false,
      latencyMs: Date.now() - started,
      message:
        error instanceof Error
          ? `Αποτυχία σύνδεσης: ${error.message}`
          : "Αποτυχία σύνδεσης webhook",
    };
  }
}

/**
 * Connectivity check for myDATA.
 * Simulator validates local config. Test/Prod probe AADE with credentials —
 * HTTP 401/403 = bad credentials; any AADE XML/HTTP response = reachable.
 */
export async function testMyDataConnection(
  config: IntegrationsConfig,
): Promise<IntegrationTestResult> {
  const started = Date.now();
  const my = readMyDataConfig(config as Prisma.JsonValue);
  const env = my.myDataEnv;

  if (env === "simulator") {
    return {
      at: new Date().toISOString(),
      ok: true,
      latencyMs: Date.now() - started,
      message: "Simulator ενεργό — δεν καλείται ΑΑΔΕ",
    };
  }

  const userId = my.myDataUserId?.trim();
  const key = my.myDataSubscriptionKey?.trim();
  if (!userId || !key) {
    return {
      at: new Date().toISOString(),
      ok: false,
      message: "Λείπουν aade-user-id ή subscription key",
    };
  }

  const endpoint = myDataEndpoint(env);
  const probeXml = `<?xml version="1.0" encoding="utf-8"?>
<InvoicesDoc xmlns="http://www.aade.gr/myDATA/invoice/v1.0"/>`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        Accept: "application/xml",
        "aade-user-id": userId,
        "ocp-apim-subscription-key": key,
      },
      body: probeXml,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await res.text().catch(() => "");
    const latencyMs = Date.now() - started;

    if (res.status === 401 || res.status === 403) {
      return {
        at: new Date().toISOString(),
        ok: false,
        status: res.status,
        latencyMs,
        message: "ΑΑΔΕ απέρριψε credentials (401/403)",
      };
    }

    // Reachable gateway — empty doc may fail validation but auth worked
    const looksLikeAade =
      text.includes("<") ||
      res.headers.get("content-type")?.includes("xml") ||
      res.status === 200 ||
      res.status === 400 ||
      res.status === 422;

    return {
      at: new Date().toISOString(),
      ok: looksLikeAade || (res.status > 0 && res.status < 500),
      status: res.status,
      latencyMs,
      message: looksLikeAade
        ? `Σύνδεση ΑΑΔΕ OK · HTTP ${res.status} (${env})`
        : `Απάντηση HTTP ${res.status} από ${endpoint}`,
    };
  } catch (error) {
    return {
      at: new Date().toISOString(),
      ok: false,
      latencyMs: Date.now() - started,
      message:
        error instanceof Error
          ? `Αποτυχία δικτύου ΑΑΔΕ: ${error.message}`
          : "Αποτυχία σύνδεσης ΑΑΔΕ",
    };
  }
}

export function publicTokenView(token: IntegrationApiToken) {
  return {
    id: token.id,
    name: token.name,
    prefix: token.prefix,
    createdAt: token.createdAt,
    lastUsedAt: token.lastUsedAt ?? null,
    revokedAt: token.revokedAt ?? null,
    active: !token.revokedAt,
  };
}

export function normalizeWebhookEvents(
  events: unknown,
): WebhookEventKey[] {
  const allowed = new Set(WEBHOOK_EVENTS.map((e) => e.key));
  if (!Array.isArray(events)) {
    return WEBHOOK_EVENTS.map((e) => e.key);
  }
  return events.filter((e): e is WebhookEventKey =>
    typeof e === "string" && allowed.has(e as WebhookEventKey),
  );
}
