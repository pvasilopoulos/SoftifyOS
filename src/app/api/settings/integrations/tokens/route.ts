import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import {
  createApiTokenValue,
  loadIntegrationsConfig,
  publicTokenView,
  saveIntegrationsConfig,
} from "@/modules/integrations/service";
import type { IntegrationApiToken } from "@/modules/integrations/types";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

const revokeSchema = z.object({
  id: z.string().min(1),
  action: z.literal("revoke"),
});

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const config = await loadIntegrationsConfig(prisma, session.tenantId);
    const tokens = (config.apiTokens ?? []).map(publicTokenView);
    return NextResponse.json({ tokens });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role !== "OWNER" && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = createSchema.parse(await request.json());
    const config = await loadIntegrationsConfig(prisma, session.tenantId);
    const { token, prefix, hash } = createApiTokenValue();
    const item: IntegrationApiToken = {
      id: `tok_${Date.now().toString(36)}`,
      name: body.name,
      prefix,
      hash,
      createdAt: new Date().toISOString(),
    };
    const next = {
      ...config,
      apiTokens: [...(config.apiTokens ?? []), item],
    };
    await saveIntegrationsConfig(prisma, session.tenantId, next);

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "integrations.api_token_create",
      entity: "api_token",
      entityId: item.id,
      meta: { name: item.name, prefix: item.prefix },
    });

    return NextResponse.json({
      token: publicTokenView(item),
      /** Shown once — store securely */
      secret: token,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Create failed") },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role !== "OWNER" && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = revokeSchema.parse(await request.json());
    const config = await loadIntegrationsConfig(prisma, session.tenantId);
    const tokens = config.apiTokens ?? [];
    const existing = tokens.find((t) => t.id === body.id);
    if (!existing) {
      return NextResponse.json({ error: "Το token δεν βρέθηκε" }, { status: 404 });
    }
    const revoked: IntegrationApiToken = {
      ...existing,
      revokedAt: new Date().toISOString(),
    };
    const updated = tokens.map((t) => (t.id === body.id ? revoked : t));
    await saveIntegrationsConfig(prisma, session.tenantId, {
      ...config,
      apiTokens: updated,
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "integrations.api_token_revoke",
      entity: "api_token",
      entityId: body.id,
    });

    return NextResponse.json({ token: publicTokenView(revoked) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Revoke failed") },
      { status: 400 },
    );
  }
}
