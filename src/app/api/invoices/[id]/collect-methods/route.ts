import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";
import { resolveSeriesPaymentMethods } from "@/modules/documents/series-payments";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const invoice = await prisma.invoice.findFirst({
      where: { id, tenantId: session.tenantId },
      select: { id: true, seriesId: true },
    });
    if (!invoice) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }

    const methods = await resolveSeriesPaymentMethods(prisma, {
      tenantId: session.tenantId,
      seriesId: invoice.seriesId,
      collectOnly: true,
      activeOnly: true,
    });

    return NextResponse.json({
      items: methods.map((m) => ({
        id: m.id,
        code: m.code,
        name: m.name,
        kind: m.kind,
        isDefault: m.isDefault,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}
