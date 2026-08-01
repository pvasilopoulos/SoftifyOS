import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";

export const dynamic = "force-dynamic";

const schema = z.object({
  webhookUrl: z.string().trim().url().optional().nullable().or(z.literal("")),
  webhookSecretHint: z.string().trim().max(80).optional().nullable(),
  skroutzEnabled: z.boolean().optional(),
  myDataEnv: z.enum(["simulator", "test", "prod"]).optional(),
  myDataUserId: z.string().trim().max(120).optional().nullable(),
  myDataSubscriptionKey: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

type Integrations = {
  webhookUrl?: string | null;
  webhookSecretHint?: string | null;
  skroutzEnabled?: boolean;
  myDataEnv?: "simulator" | "test" | "prod";
  myDataUserId?: string | null;
  myDataSubscriptionKey?: string | null;
  notes?: string | null;
};

function maskKey(key: string | null | undefined) {
  if (!key) return "";
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
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
    const integrations = (settings.integrationsJson as Integrations | null) ?? {};
    return NextResponse.json({
      integrations: {
        webhookUrl: integrations.webhookUrl ?? "",
        webhookSecretHint: integrations.webhookSecretHint ?? "",
        skroutzEnabled: Boolean(integrations.skroutzEnabled),
        myDataEnv: integrations.myDataEnv ?? "simulator",
        myDataUserId: integrations.myDataUserId ?? "",
        myDataSubscriptionKeyHint: maskKey(integrations.myDataSubscriptionKey),
        hasMyDataSubscriptionKey: Boolean(integrations.myDataSubscriptionKey),
        notes: integrations.notes ?? "",
      },
      endpoints: {
        health: "/api/health",
        scriptsUiEvent: "/api/scripts/ui-event",
        myDataQueue: "/api/mydata/submissions",
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
    const prev = (current?.integrationsJson as Integrations | null) ?? {};
    const next: Integrations = {
      ...prev,
      ...(body.webhookUrl !== undefined
        ? { webhookUrl: body.webhookUrl || null }
        : {}),
      ...(body.webhookSecretHint !== undefined
        ? { webhookSecretHint: body.webhookSecretHint || null }
        : {}),
      ...(body.skroutzEnabled !== undefined
        ? { skroutzEnabled: body.skroutzEnabled }
        : {}),
      ...(body.myDataEnv !== undefined ? { myDataEnv: body.myDataEnv } : {}),
      ...(body.myDataUserId !== undefined
        ? { myDataUserId: body.myDataUserId || null }
        : {}),
      ...(body.myDataSubscriptionKey !== undefined
        ? {
            myDataSubscriptionKey:
              body.myDataSubscriptionKey === "" ||
              body.myDataSubscriptionKey == null
                ? null
                : body.myDataSubscriptionKey.startsWith("••••") ||
                    body.myDataSubscriptionKey.includes("…")
                  ? prev.myDataSubscriptionKey
                  : body.myDataSubscriptionKey,
          }
        : {}),
      ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
    };

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
        keys: Object.keys(body).filter((k) => k !== "myDataSubscriptionKey"),
        myDataEnv: next.myDataEnv,
        hasMyDataKey: Boolean(next.myDataSubscriptionKey),
      },
    });

    return NextResponse.json({
      integrations: {
        ...next,
        myDataSubscriptionKey: undefined,
        myDataSubscriptionKeyHint: maskKey(next.myDataSubscriptionKey),
        hasMyDataSubscriptionKey: Boolean(next.myDataSubscriptionKey),
      },
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
