import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import {
  createWebhookSecret,
  normalizeWebhookEvents,
  publicTokenView,
} from "@/modules/integrations/service";
import {
  asIntegrationsConfig,
  maskSecret,
  type IntegrationsConfig,
} from "@/modules/integrations/types";

export const dynamic = "force-dynamic";

const schema = z.object({
  webhookUrl: z.string().trim().url().optional().nullable().or(z.literal("")),
  webhookSecretHint: z.string().trim().max(80).optional().nullable(),
  webhookEnabled: z.boolean().optional(),
  webhookEvents: z.array(z.string()).optional(),
  regenerateWebhookSecret: z.boolean().optional(),
  clearWebhookSecret: z.boolean().optional(),
  skroutzEnabled: z.boolean().optional(),
  skroutzShopId: z.string().trim().max(80).optional().nullable(),
  marketplaceNotes: z.string().trim().max(2000).optional().nullable(),
  myDataEnv: z.enum(["simulator", "test", "prod"]).optional(),
  myDataUserId: z.string().trim().max(120).optional().nullable(),
  myDataSubscriptionKey: z.string().trim().max(200).optional().nullable(),
  clearMyDataSubscriptionKey: z.boolean().optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
  erganiEnv: z.enum(["simulator", "test", "prod"]).optional(),
});

function publicView(integrations: IntegrationsConfig) {
  return {
    webhookUrl: integrations.webhookUrl ?? "",
    webhookSecretHint: integrations.webhookSecretHint ?? "",
    webhookEnabled: integrations.webhookEnabled !== false,
    webhookEvents: normalizeWebhookEvents(integrations.webhookEvents),
    hasWebhookSecret: Boolean(integrations.webhookSecret),
    webhookSecretHintMasked: maskSecret(integrations.webhookSecret),
    skroutzEnabled: Boolean(integrations.skroutzEnabled),
    skroutzShopId: integrations.skroutzShopId ?? "",
    marketplaceNotes: integrations.marketplaceNotes ?? "",
    myDataEnv: integrations.myDataEnv ?? "simulator",
    myDataUserId: integrations.myDataUserId ?? "",
    myDataSubscriptionKeyHint: maskSecret(integrations.myDataSubscriptionKey),
    hasMyDataSubscriptionKey: Boolean(integrations.myDataSubscriptionKey),
    notes: integrations.notes ?? "",
    erganiEnv: integrations.erganiEnv ?? "simulator",
    lastWebhookTest: integrations.lastWebhookTest ?? null,
    lastMyDataTest: integrations.lastMyDataTest ?? null,
    apiTokens: (integrations.apiTokens ?? []).map(publicTokenView),
  };
}

async function ensureSettings(tenantId: string) {
  return prisma.tenantSettings.upsert({
    where: { tenantId },
    create: { tenantId },
    update: {},
  });
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const settings = await ensureSettings(session.tenantId);
    const integrations = asIntegrationsConfig(settings.integrationsJson);
    return NextResponse.json({
      integrations: publicView(integrations),
      endpoints: {
        health: "/api/health",
        scriptsUiEvent: "/api/scripts/ui-event",
        myDataQueue: "/api/mydata/submissions",
        configExport: "/api/settings/export",
        integrationsTest: "/api/settings/integrations/test",
        apiTokens: "/api/settings/integrations/tokens",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role !== "OWNER" && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = schema.parse(await request.json());
    await ensureSettings(session.tenantId);
    const current = await prisma.tenantSettings.findUnique({
      where: { tenantId: session.tenantId },
    });
    const prev = asIntegrationsConfig(current?.integrationsJson);
    let generatedSecret: string | undefined;

    const next: IntegrationsConfig = {
      ...prev,
      ...(body.webhookUrl !== undefined
        ? { webhookUrl: body.webhookUrl || null }
        : {}),
      ...(body.webhookSecretHint !== undefined
        ? { webhookSecretHint: body.webhookSecretHint || null }
        : {}),
      ...(body.webhookEnabled !== undefined
        ? { webhookEnabled: body.webhookEnabled }
        : {}),
      ...(body.webhookEvents !== undefined
        ? { webhookEvents: normalizeWebhookEvents(body.webhookEvents) }
        : {}),
      ...(body.skroutzEnabled !== undefined
        ? { skroutzEnabled: body.skroutzEnabled }
        : {}),
      ...(body.skroutzShopId !== undefined
        ? { skroutzShopId: body.skroutzShopId || null }
        : {}),
      ...(body.marketplaceNotes !== undefined
        ? { marketplaceNotes: body.marketplaceNotes || null }
        : {}),
      ...(body.myDataEnv !== undefined ? { myDataEnv: body.myDataEnv } : {}),
      ...(body.myDataUserId !== undefined
        ? { myDataUserId: body.myDataUserId || null }
        : {}),
      ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
      ...(body.erganiEnv !== undefined ? { erganiEnv: body.erganiEnv } : {}),
    };

    if (body.clearWebhookSecret) {
      next.webhookSecret = null;
    } else if (body.regenerateWebhookSecret) {
      generatedSecret = createWebhookSecret();
      next.webhookSecret = generatedSecret;
      next.webhookSecretHint = maskSecret(generatedSecret);
    }

    if (body.clearMyDataSubscriptionKey) {
      next.myDataSubscriptionKey = null;
    } else if (body.myDataSubscriptionKey !== undefined) {
      const key = body.myDataSubscriptionKey;
      next.myDataSubscriptionKey =
        key === "" || key == null
          ? prev.myDataSubscriptionKey ?? null
          : key.startsWith("••••") || key.includes("…")
            ? prev.myDataSubscriptionKey
            : key;
    }

    await prisma.tenantSettings.update({
      where: { tenantId: session.tenantId },
      data: { integrationsJson: next },
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "integrations.update",
      entity: "tenant_settings",
      entityId: current?.id,
      meta: {
        keys: Object.keys(body).filter(
          (k) =>
            k !== "myDataSubscriptionKey" && k !== "regenerateWebhookSecret",
        ),
        myDataEnv: next.myDataEnv,
        hasMyDataKey: Boolean(next.myDataSubscriptionKey),
        webhookEnabled: next.webhookEnabled !== false,
        regeneratedWebhookSecret: Boolean(generatedSecret),
      },
    });

    return NextResponse.json({
      integrations: publicView(next),
      ...(generatedSecret ? { webhookSecret: generatedSecret } : {}),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Update failed") },
      { status: 400 },
    );
  }
}
