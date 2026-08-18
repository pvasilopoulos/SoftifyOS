import { NextResponse } from "next/server";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { prisma } from "@/server/db";
import {
  importCatalogFromBuffer,
  type CatalogKind,
} from "@/modules/catalogs/import";

export const dynamic = "force-dynamic";

function requireAdmin(session: { role: string } | null) {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (
    session.role !== "SUPER_ADMIN" &&
    session.role !== "OWNER" &&
    session.role !== "ADMIN"
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

const kinds = new Set<CatalogKind>(["payment-methods", "units", "roles"]);

export async function POST(request: Request) {
  try {
    const session = await getSession();
    const denied = requireAdmin(session);
    if (denied) return denied;

    const form = await request.formData();
    const kind = String(form.get("kind") || "") as CatalogKind;
    const file = form.get("file");
    if (!kinds.has(kind)) {
      return NextResponse.json({ error: "Άγνωστος τύπος καταλόγου" }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Λείπει αρχείο CSV/Excel" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await importCatalogFromBuffer(prisma, {
      tenantId: session!.tenantId,
      kind,
      buffer,
      filename: file.name || `${kind}.csv`,
    });

    await writeAuditEvent({
      tenantId: session!.tenantId,
      userId: session!.sub,
      action: "settings.catalogs.import",
      entity: kind,
      entityId: session!.tenantId,
      meta: {
        filename: file.name,
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        errors: result.errors.length,
      },
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Αποτυχία εισαγωγής") },
      { status: 500 },
    );
  }
}
