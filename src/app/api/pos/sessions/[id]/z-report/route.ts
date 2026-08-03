import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";
import { buildPosSessionZReport } from "@/modules/pos/z-report";

export const dynamic = "force-dynamic";

/** Z-report / day-end summary for a POS session. */
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
    const report = await buildPosSessionZReport(prisma, {
      tenantId: session.tenantId,
      sessionId: id,
    });
    if (!report) {
      return NextResponse.json({ error: "Δεν βρέθηκε βάρδια" }, { status: 404 });
    }
    return NextResponse.json({ item: report });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Z-report failed") },
      { status: 500 },
    );
  }
}
