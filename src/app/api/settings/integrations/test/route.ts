import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import {
  loadIntegrationsConfig,
  saveIntegrationsConfig,
  testMyDataConnection,
  testWebhookDelivery,
} from "@/modules/integrations/service";

export const dynamic = "force-dynamic";

const schema = z.object({
  target: z.enum(["webhook", "mydata"]),
});

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role !== "OWNER" && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = schema.parse(await request.json());
    const config = await loadIntegrationsConfig(prisma, session.tenantId);

    const result =
      body.target === "webhook"
        ? await testWebhookDelivery(config)
        : await testMyDataConnection(config);

    const next = {
      ...config,
      ...(body.target === "webhook"
        ? { lastWebhookTest: result }
        : { lastMyDataTest: result }),
    };
    await saveIntegrationsConfig(prisma, session.tenantId, next);

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action:
        body.target === "webhook"
          ? "integrations.webhook_test"
          : "integrations.mydata_test",
      entity: "tenant_settings",
      meta: {
        ok: result.ok,
        status: result.status ?? null,
        message: result.message,
        latencyMs: result.latencyMs ?? null,
      },
    });

    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρο αίτημα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Test failed") },
      { status: 400 },
    );
  }
}
