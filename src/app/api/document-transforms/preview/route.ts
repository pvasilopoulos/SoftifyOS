import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";
import {
  previewTransform,
  TransformError,
  transformPreviewSchema,
} from "@/modules/document-transforms";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = transformPreviewSchema.parse(await request.json());
    const preview = await previewTransform(prisma, session.tenantId, body);
    return NextResponse.json({ preview });
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
      { error: getErrorMessage(error, "Preview failed") },
      { status: 400 },
    );
  }
}
