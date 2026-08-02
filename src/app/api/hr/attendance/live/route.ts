import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";
import { loadLiveAttendance } from "@/modules/hr/service";

export const dynamic = "force-dynamic";

/** Live board παρουσίας ημέρας */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const data = await loadLiveAttendance(prisma, session.tenantId);
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Live attendance failed") },
      { status: 500 },
    );
  }
}
