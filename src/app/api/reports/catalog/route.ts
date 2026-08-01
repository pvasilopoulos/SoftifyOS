import { NextResponse } from "next/server";
import { getSession } from "@/platform/auth/session";
import { REPORT_CATALOG, REPORT_CATEGORY_LABEL } from "@/modules/reports/catalog";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    items: REPORT_CATALOG,
    categories: REPORT_CATEGORY_LABEL,
  });
}
