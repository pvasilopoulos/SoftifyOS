import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { getErrorMessage } from "@/shared/lib/safe";
import { reportRunSchema } from "@/modules/reports/schemas";
import { runReport } from "@/modules/reports/engine";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = reportRunSchema.parse(await request.json());
    if (!body.reportId && !body.metrics?.length) {
      return NextResponse.json(
        { error: "Απαιτείται reportId ή metrics" },
        { status: 400 },
      );
    }
    const result = await runReport(prisma, session.tenantId, body);
    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Run failed") },
      { status: 400 },
    );
  }
}
