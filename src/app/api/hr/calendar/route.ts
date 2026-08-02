import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";
import { HrError } from "@/modules/hr/errors";
import { loadLeaveCalendar } from "@/modules/hr/suite";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const sp = request.nextUrl.searchParams;
    const now = new Date();
    const from =
      sp.get("from") ||
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
        .toISOString()
        .slice(0, 10);
    const to =
      sp.get("to") ||
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
        .toISOString()
        .slice(0, 10);
    const data = await loadLeaveCalendar(prisma, session.tenantId, { from, to });
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof HrError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}
