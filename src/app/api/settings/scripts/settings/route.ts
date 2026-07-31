import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { scriptSettingsPatchSchema } from "@/modules/scripts/schemas";

export const dynamic = "force-dynamic";

function requireAdmin(session: { role: string } | null) {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "OWNER" && session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function PATCH(request: Request) {
  try {
    const session = await getSession();
    const denied = requireAdmin(session);
    if (denied) return denied;

    const body = scriptSettingsPatchSchema.parse(await request.json());
    const item = await prisma.scriptSettings.upsert({
      where: { tenantId: session!.tenantId },
      create: {
        tenantId: session!.tenantId,
        scriptsEnabled: body.scriptsEnabled ?? true,
        maxTimeoutMs: body.maxTimeoutMs ?? 3000,
        maxHttpCalls: body.maxHttpCalls ?? 5,
      },
      update: {
        ...(body.scriptsEnabled !== undefined
          ? { scriptsEnabled: body.scriptsEnabled }
          : {}),
        ...(body.maxTimeoutMs !== undefined
          ? { maxTimeoutMs: body.maxTimeoutMs }
          : {}),
        ...(body.maxHttpCalls !== undefined
          ? { maxHttpCalls: body.maxHttpCalls }
          : {}),
      },
    });

    await writeAuditEvent({
      tenantId: session!.tenantId,
      userId: session!.sub,
      action: "settings.scripts.settings_update",
      entity: "script_settings",
      entityId: item.id,
      meta: {
        scriptsEnabled: item.scriptsEnabled,
        maxTimeoutMs: item.maxTimeoutMs,
        maxHttpCalls: item.maxHttpCalls,
      },
    });

    return NextResponse.json({ item });
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
