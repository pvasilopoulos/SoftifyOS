import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { glAccountUpsertSchema } from "@/modules/ledger/schemas";
import { listGlAccounts } from "@/modules/ledger/service";

export const dynamic = "force-dynamic";

function requireAdmin(session: { role: string } | null) {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "OWNER" && session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const items = await listGlAccounts(prisma, session.tenantId);
    return NextResponse.json({ items });
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
    const denied = requireAdmin(session);
    if (denied) return denied;

    const body = glAccountUpsertSchema.parse(await request.json());
    if (body.parentId) {
      const parent = await prisma.glAccount.findFirst({
        where: { id: body.parentId, tenantId: session!.tenantId },
      });
      if (!parent) {
        return NextResponse.json({ error: "Μη έγκυρος parent" }, { status: 400 });
      }
    }

    const item = await prisma.glAccount.create({
      data: {
        tenantId: session!.tenantId,
        code: body.code,
        name: body.name,
        type: body.type,
        parentId: body.parentId ?? null,
        isPostable: body.isPostable ?? true,
        isActive: body.isActive ?? true,
      },
    });

    await writeAuditEvent({
      tenantId: session!.tenantId,
      userId: session!.sub,
      action: "settings.gl_accounts.create",
      entity: "gl_account",
      entityId: item.id,
      meta: { code: item.code },
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
      return NextResponse.json({ error: "Ο κωδικός υπάρχει ήδη" }, { status: 409 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Create failed") },
      { status: 400 },
    );
  }
}
