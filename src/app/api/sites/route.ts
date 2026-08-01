import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { siteCreateSchema } from "@/modules/documents/schemas";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const kind = new URL(request.url).searchParams.get("kind");
    const items = await prisma.site.findMany({
      where: {
        tenantId: session.tenantId,
        ...(kind === "BRANCH" || kind === "WAREHOUSE" || kind === "TILL"
          ? { kind }
          : {}),
      },
      orderBy: [{ kind: "asc" }, { code: "asc" }],
      include: {
        parent: { select: { id: true, code: true, name: true } },
        _count: { select: { children: true, stockBins: true } },
      },
    });
    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "List failed") },
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
    if (session.role === "VIEWER" || session.role === "MEMBER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = siteCreateSchema.parse(await request.json());
    if (body.parentId) {
      const parent = await prisma.site.findFirst({
        where: { id: body.parentId, tenantId: session.tenantId },
      });
      if (!parent) {
        return NextResponse.json({ error: "Μη έγκυρο parent site" }, { status: 400 });
      }
    }

    const item = await prisma.site.create({
      data: {
        tenantId: session.tenantId,
        code: body.code,
        name: body.name,
        kind: body.kind,
        parentId: body.parentId || null,
        isActive: body.isActive ?? true,
      },
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "site.create",
      entity: "site",
      entityId: item.id,
      meta: { code: item.code },
    });

    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json({ error: "Ο κωδικός site υπάρχει ήδη" }, { status: 409 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Create failed") },
      { status: 400 },
    );
  }
}
