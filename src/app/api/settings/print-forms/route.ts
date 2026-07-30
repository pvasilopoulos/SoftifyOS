import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { documentKindSchema } from "@/modules/documents/schemas";
import { printFormUpsertSchema } from "@/modules/print-forms/schemas";
import { listPrintForms } from "@/modules/print-forms/service";

export const dynamic = "force-dynamic";

function requireAdmin(session: { role: string } | null) {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "OWNER" && session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const kind = request.nextUrl.searchParams.get("kind") || undefined;
    const parsed = kind
      ? documentKindSchema.safeParse(kind)
      : { success: true as const, data: undefined };
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
    }
    const items = await listPrintForms(prisma, session.tenantId, {
      kind: parsed.data,
      activeOnly: request.nextUrl.searchParams.get("active") === "1",
    });
    return NextResponse.json({ items });
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
    const denied = requireAdmin(session);
    if (denied) return denied;

    const body = printFormUpsertSchema.parse(await request.json());
    if (body.isDefault) {
      await prisma.printForm.updateMany({
        where: {
          tenantId: session!.tenantId,
          documentKind: body.documentKind,
          isDefault: true,
        },
        data: { isDefault: false },
      });
    }

    const item = await prisma.printForm.create({
      data: {
        tenantId: session!.tenantId,
        code: body.code,
        name: body.name,
        documentKind: body.documentKind,
        paper: body.paper ?? "A4",
        orientation: body.orientation ?? "PORTRAIT",
        bodyJson: body.bodyJson as unknown as Prisma.InputJsonValue,
        isDefault: body.isDefault ?? false,
        isActive: body.isActive ?? true,
      },
    });

    await writeAuditEvent({
      tenantId: session!.tenantId,
      userId: session!.sub,
      action: "settings.print_forms.create",
      entity: "print_form",
      entityId: item.id,
      meta: { code: item.code },
    });

    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json({ error: "Ο κωδικός υπάρχει ήδη" }, { status: 409 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Create failed") },
      { status: 400 },
    );
  }
}
