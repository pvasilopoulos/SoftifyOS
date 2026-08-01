import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const status = request.nextUrl.searchParams.get("status") || undefined;
    const items = await prisma.myDataSubmission.findMany({
      where: {
        tenantId: session.tenantId,
        ...(status
          ? {
              status: status as
                | "PENDING"
                | "SENT"
                | "ACCEPTED"
                | "REJECTED"
                | "CANCELLED",
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }],
      take: 100,
    });
    return NextResponse.json({
      items: items.map((s) => ({
        ...s,
        lastAttemptAt: s.lastAttemptAt?.toISOString() ?? null,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}
