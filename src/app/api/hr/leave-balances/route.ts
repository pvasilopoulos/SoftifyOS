import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";
import { loadLeaveBalances } from "@/modules/hr/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = new URL(request.url);
    const year = Number(url.searchParams.get("year") || new Date().getFullYear());
    const employeeId = url.searchParams.get("employeeId") || undefined;
    const items = await loadLeaveBalances(prisma, session.tenantId, {
      year: Number.isFinite(year) ? year : new Date().getFullYear(),
      employeeId,
    });
    return NextResponse.json({ items, year });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}
