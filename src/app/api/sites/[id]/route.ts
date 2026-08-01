import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { siteUpdateSchema } from "@/modules/documents/schemas";
import { LedgerError } from "@/modules/ledger/service";
import { deleteSite, updateSite } from "@/modules/org/service";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER" || session.role === "MEMBER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;
    const body = siteUpdateSchema.parse(await request.json());
    const item = await updateSite(prisma, {
      tenantId: session.tenantId,
      id,
      ...body,
    });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "site.update",
      entity: "site",
      entityId: item.id,
      meta: { code: item.code, kind: item.kind },
    });
    return NextResponse.json({ item });
  } catch (error) {
    if (error instanceof LedgerError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json({ error: "Ο κωδικός υπάρχει ήδη" }, { status: 409 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Update failed") },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER" || session.role === "MEMBER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;
    const result = await deleteSite(prisma, {
      tenantId: session.tenantId,
      id,
    });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "site.delete",
      entity: "site",
      entityId: id,
      meta: { soft: !("deleted" in result && result.deleted) },
    });
    return NextResponse.json({ item: result });
  } catch (error) {
    if (error instanceof LedgerError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Delete failed") },
      { status: 400 },
    );
  }
}
