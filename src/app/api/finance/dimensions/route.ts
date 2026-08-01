import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { costCenterSchema, legalEntitySchema } from "@/modules/ledger/schemas";
import {
  ensureDefaultLegalEntity,
  listCostCenters,
  listLegalEntities,
  upsertCostCenter,
  upsertLegalEntity,
} from "@/modules/ledger/controlling";
import { LedgerError } from "@/modules/ledger/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureDefaultLegalEntity(
      prisma,
      session.tenantId,
      session.tenantName,
    );
    const [legalEntities, costCenters] = await Promise.all([
      listLegalEntities(prisma, session.tenantId),
      listCostCenters(prisma, session.tenantId),
    ]);
    return NextResponse.json({ legalEntities, costCenters });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const raw = await request.json();
    const kind = raw?.kind as string;
    if (kind === "legal-entity") {
      const body = legalEntitySchema.parse(raw);
      const item = await upsertLegalEntity(prisma, {
        tenantId: session.tenantId,
        ...body,
      });
      await writeAuditEvent({
        tenantId: session.tenantId,
        userId: session.sub,
        action: "finance.legal_entity.upsert",
        entity: "legal_entity",
        entityId: item.id,
      });
      return NextResponse.json({ item }, { status: 201 });
    }
    if (kind === "cost-center") {
      const body = costCenterSchema.parse(raw);
      const item = await upsertCostCenter(prisma, {
        tenantId: session.tenantId,
        ...body,
      });
      await writeAuditEvent({
        tenantId: session.tenantId,
        userId: session.sub,
        action: "finance.cost_center.upsert",
        entity: "cost_center",
        entityId: item.id,
      });
      return NextResponse.json({ item }, { status: 201 });
    }
    return NextResponse.json({ error: "Unknown kind" }, { status: 400 });
  } catch (error) {
    if (error instanceof LedgerError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Save failed") },
      { status: 400 },
    );
  }
}
