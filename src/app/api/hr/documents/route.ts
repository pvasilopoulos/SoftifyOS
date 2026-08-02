import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { hrDocumentSchema } from "@/modules/hr/schemas";
import { HrError } from "@/modules/hr/errors";
import {
  createHrDocument,
  deleteHrDocument,
  listHrDocuments,
} from "@/modules/hr/suite";

export const dynamic = "force-dynamic";

function serialize(d: Awaited<ReturnType<typeof createHrDocument>>) {
  return {
    ...d,
    issuedAt: d.issuedAt?.toISOString() ?? null,
    expiresAt: d.expiresAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const employeeId =
      request.nextUrl.searchParams.get("employeeId") || undefined;
    const items = await listHrDocuments(prisma, session.tenantId, {
      employeeId,
    });
    return NextResponse.json({ items: items.map(serialize) });
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
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = hrDocumentSchema.parse(await request.json());
    const item = await createHrDocument(prisma, {
      tenantId: session.tenantId,
      data: body,
    });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "hr_document.create",
      entity: "hr_document",
      entityId: item.id,
      meta: { employeeId: item.employeeId, category: item.category },
    });
    return NextResponse.json({ item: serialize(item) }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    if (error instanceof HrError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Create failed") },
      { status: 400 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const id = request.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Λείπει id" }, { status: 400 });
    }
    await deleteHrDocument(prisma, { tenantId: session.tenantId, id });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "hr_document.delete",
      entity: "hr_document",
      entityId: id,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof HrError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Delete failed") },
      { status: 400 },
    );
  }
}
