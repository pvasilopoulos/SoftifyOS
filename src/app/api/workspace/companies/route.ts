import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";
import { ensureDefaultLegalEntity } from "@/modules/ledger/controlling";
import {
  getAllowedCompanyIds,
  resolveCompanyForTenant,
} from "@/platform/tenancy/workspace";

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

    const membership = await prisma.membership.findUnique({
      where: {
        tenantId_userId: {
          tenantId: session.tenantId,
          userId: session.sub,
        },
      },
      select: { id: true, role: true },
    });

    const allowedCompanyIds = membership
      ? await getAllowedCompanyIds(prisma, {
          membershipId: membership.id,
          role: membership.role,
        })
      : null;

    const { companies } = await resolveCompanyForTenant(prisma, {
      tenantId: session.tenantId,
      tenantName: session.tenantName,
      allowedCompanyIds,
    });

    return NextResponse.json({
      items: companies.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        vatNumber: c.vatNumber,
        isDefault: c.isDefault,
      })),
      currentCompanyId: session.legalEntityId,
      restricted: allowedCompanyIds !== null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}
