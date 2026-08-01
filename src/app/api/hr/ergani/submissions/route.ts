import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";
import { listErganiSubmissions } from "@/modules/hr/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const status = request.nextUrl.searchParams.get("status") || undefined;
    const items = await listErganiSubmissions(prisma, session.tenantId, {
      status,
    });
    return NextResponse.json({
      items: items.map((i) => ({
        id: i.id,
        entityType: i.entityType,
        entityId: i.entityId,
        eventKind: i.eventKind,
        status: i.status,
        externalRef: i.externalRef,
        attempts: i.attempts,
        lastError: i.lastError,
        processedAt: i.processedAt?.toISOString() ?? null,
        createdAt: i.createdAt.toISOString(),
        updatedAt: i.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}
