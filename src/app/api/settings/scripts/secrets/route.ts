import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { scriptSecretUpsertSchema } from "@/modules/scripts/schemas";
import { encryptSecret } from "@/modules/scripts/secrets";

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

    const body = scriptSecretUpsertSchema.parse(await request.json());
    const valueEnc = encryptSecret(body.value);

    const item = await prisma.scriptSecret.upsert({
      where: {
        tenantId_key: { tenantId: session!.tenantId, key: body.key },
      },
      create: {
        tenantId: session!.tenantId,
        key: body.key,
        valueEnc,
      },
      update: { valueEnc },
      select: { id: true, key: true, updatedAt: true, createdAt: true },
    });

    await writeAuditEvent({
      tenantId: session!.tenantId,
      userId: session!.sub,
      action: "settings.scripts.secret_upsert",
      entity: "script_secret",
      entityId: item.id,
      meta: { key: item.key },
    });

    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json({ error: "Το key υπάρχει ήδη" }, { status: 409 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Save failed") },
      { status: 400 },
    );
  }
}
