import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";

export const dynamic = "force-dynamic";

/** Full myDATA submission detail for Live hub. */
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
    const row = await prisma.myDataSubmission.findFirst({
      where: { id, tenantId: session.tenantId },
    });
    if (!row) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }
    return NextResponse.json({
      item: {
        ...row,
        lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}
