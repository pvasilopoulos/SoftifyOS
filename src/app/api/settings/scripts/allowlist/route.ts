import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { scriptAllowlistUpsertSchema } from "@/modules/scripts/schemas";

export const dynamic = "force-dynamic";

function requireAdmin(session: { role: string } | null) {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "OWNER" && session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    const denied = requireAdmin(session);
    if (denied) return denied;

    const body = scriptAllowlistUpsertSchema.parse(await request.json());
    const host = body.host.toLowerCase();

    const item = await prisma.scriptHttpAllowlist.upsert({
      where: {
        tenantId_host: { tenantId: session!.tenantId, host },
      },
      create: {
        tenantId: session!.tenantId,
        host,
      },
      update: {},
    });

    await writeAuditEvent({
      tenantId: session!.tenantId,
      userId: session!.sub,
      action: "settings.scripts.allowlist_add",
      entity: "script_http_allowlist",
      entityId: item.id,
      meta: { host: item.host },
    });

    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρο hostname" }, { status: 400 });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json({ error: "Το host υπάρχει ήδη" }, { status: 409 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Save failed") },
      { status: 400 },
    );
  }
}
