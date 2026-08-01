import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";
import {
  listAvailableTransforms,
  TransformError,
} from "@/modules/document-transforms";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    const sourceKind = searchParams.get("sourceKind");
    const sourceId = searchParams.get("sourceId");
    if (!sourceKind || !sourceId) {
      return NextResponse.json(
        { error: "sourceKind και sourceId απαιτούνται" },
        { status: 400 },
      );
    }

    // Retail receipts reuse invoice_* handlers
    const kindForRules =
      sourceKind === "RETAIL_RECEIPT" ? "SALES_INVOICE" : sourceKind;

    const items = await listAvailableTransforms(
      prisma,
      session.tenantId,
      kindForRules,
      sourceId,
    );
    return NextResponse.json({ items });
  } catch (error) {
    if (error instanceof TransformError) {
      return NextResponse.json(
        { error: error.message, ...error.extra },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Available failed") },
      { status: 500 },
    );
  }
}
