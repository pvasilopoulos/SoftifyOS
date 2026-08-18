import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/platform/auth/session";
import {
  type CatalogKind,
  readBundledCatalogCsv,
} from "@/modules/catalogs/import";

export const dynamic = "force-dynamic";

const kinds = new Set<CatalogKind>(["payment-methods", "units", "roles"]);

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const kind = request.nextUrl.searchParams.get("kind") as CatalogKind | null;
  if (!kind || !kinds.has(kind)) {
    return NextResponse.json({ error: "Άγνωστος τύπος καταλόγου" }, { status: 400 });
  }
  const csv = `\uFEFF${readBundledCatalogCsv(kind)}`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${kind}.csv"`,
    },
  });
}
