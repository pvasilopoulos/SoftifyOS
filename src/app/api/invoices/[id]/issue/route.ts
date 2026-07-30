import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await context.params;
    const invoice = await prisma.invoice.findFirst({
      where: { id, tenantId: session.tenantId },
    });
    if (!invoice) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }
    if (invoice.status !== "DRAFT") {
      return NextResponse.json(
        { error: "Μόνο πρόχειρα τιμολόγια εκδίδονται" },
        { status: 400 },
      );
    }

    const updated = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: "ISSUED",
        issuedAt: invoice.issuedAt ?? new Date(),
      },
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "invoice.issue",
      entity: "invoice",
      entityId: invoice.id,
      meta: { number: updated.number },
    });

    return NextResponse.json({ item: { id: updated.id, status: updated.status } });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Issue failed") },
      { status: 400 },
    );
  }
}
