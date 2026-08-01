import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import {
  executeTransform,
  TransformError,
  transformExecuteSchema,
} from "@/modules/document-transforms";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = transformExecuteSchema.parse(await request.json());
    const result = await executeTransform(prisma, {
      tenantId: session.tenantId,
      userId: session.sub,
      ruleId: body.ruleId,
      sourceId: body.sourceId,
      seriesId: body.seriesId,
      notes: body.notes,
      lines: body.lines,
      issueMode: body.issueMode,
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "document.transform",
      entity: "document_transform",
      entityId: result.targetId,
      meta: {
        ruleId: body.ruleId,
        sourceId: body.sourceId,
        targetKind: result.targetKind,
        targetNumber: result.targetNumber,
      },
    });

    return NextResponse.json({ item: result }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    if (error instanceof TransformError) {
      return NextResponse.json(
        { error: error.message, ...error.extra },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Execute failed") },
      { status: 400 },
    );
  }
}
