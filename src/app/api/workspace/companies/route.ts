import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";
import {
  ensureDefaultLegalEntity,
  listLegalEntities,
} from "@/modules/ledger/controlling";

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
    const items = await listLegalEntities(prisma, session.tenantId);
    return NextResponse.json({
      items: items
        .filter((c) => c.isActive)
        .map((c) => ({
          id: c.id,
          code: c.code,
          name: c.name,
          vatNumber: c.vatNumber,
          isDefault: c.isDefault,
        })),
      currentCompanyId: session.legalEntityId,
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}
