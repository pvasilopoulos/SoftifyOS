import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import {
  SettlementError,
  serializeSettlement,
  voidSettlement,
} from "@/modules/settlements/service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, ctx: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role !== "OWNER" && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;
    const item = await voidSettlement(prisma, {
      tenantId: session.tenantId,
      id,
      userId: session.sub,
    });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "settlement.void",
      entity: "settlement",
      entityId: id,
      meta: { number: item.number },
    });
    return NextResponse.json({
      item: serializeSettlement(item as never),
    });
  } catch (error) {
    if (error instanceof SettlementError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Void failed") },
      { status: 400 },
    );
  }
}
