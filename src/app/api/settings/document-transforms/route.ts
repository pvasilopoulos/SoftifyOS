import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";
import {
  ensureTransformRules,
  listTransformRules,
  transformRuleCreateSchema,
} from "@/modules/document-transforms";
import { writeAuditEvent } from "@/platform/tenancy/audit";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role !== "OWNER" && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const items = await listTransformRules(prisma, session.tenantId);
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
    if (session.role !== "OWNER" && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    await ensureTransformRules(prisma, session.tenantId);
    const body = transformRuleCreateSchema.parse(await request.json());

    if (body.defaultSeriesId) {
      const series = await prisma.documentSeries.findFirst({
        where: {
          id: body.defaultSeriesId,
          tenantId: session.tenantId,
          kind: body.targetKind,
          isActive: true,
        },
      });
      if (!series) {
        return NextResponse.json(
          { error: "Η σειρά δεν ταιριάζει με τον τύπο στόχου" },
          { status: 400 },
        );
      }
    }

    const item = await prisma.documentTransformRule.create({
      data: {
        tenantId: session.tenantId,
        code: body.code.toUpperCase(),
        name: body.name,
        description: body.description ?? null,
        sourceKind: body.sourceKind,
        targetKind: body.targetKind,
        handlerKey: body.handlerKey,
        isActive: body.isActive ?? true,
        sortOrder: body.sortOrder ?? 100,
        allowPartial: body.allowPartial ?? true,
        coverageMode: body.coverageMode ?? "QUANTITY",
        issueMode: body.issueMode ?? "ISSUE_NOW",
        copyNotes: body.copyNotes ?? true,
        defaultSeriesId: body.defaultSeriesId ?? null,
        isSystem: false,
      },
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "transform_rule.create",
      entity: "document_transform_rule",
      entityId: item.id,
      meta: { code: item.code, handlerKey: item.handlerKey },
    });

    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Create failed") },
      { status: 400 },
    );
  }
}
