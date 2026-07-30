import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { upsertLoyaltyProgramSchema } from "@/modules/loyalty/schemas";
import {
  ensureLoyaltyProgram,
  upsertLoyaltyProgram,
} from "@/modules/loyalty/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const program = await ensureLoyaltyProgram(prisma, session.tenantId);
    return NextResponse.json({ item: program });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role !== "OWNER" && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = upsertLoyaltyProgramSchema.parse(await request.json());
    const program = await upsertLoyaltyProgram(prisma, {
      tenantId: session.tenantId,
      data: body,
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "loyalty.program.update",
      entity: "loyalty_program",
      entityId: program.id,
      meta: body,
    });

    return NextResponse.json({ item: program });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Save failed") },
      { status: 500 },
    );
  }
}
