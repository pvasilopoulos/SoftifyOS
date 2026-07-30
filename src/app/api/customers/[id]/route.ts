import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const customer = await prisma.customer.findFirst({
      where: { id, tenantId: session.tenantId },
      include: {
        branches: {
          orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
          include: {
            spaces: { orderBy: [{ type: "asc" }, { name: "asc" }] },
            _count: { select: { spaces: true } },
          },
        },
      },
    });

    if (!customer) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }

    return NextResponse.json({
      item: {
        ...customer,
        branches: customer.branches.map((b) => ({
          ...b,
          spaces: b.spaces.map((s) => ({
            ...s,
            areaSqm: s.areaSqm == null ? null : Number(s.areaSqm),
          })),
          spaceCount: b._count.spaces,
        })),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}
