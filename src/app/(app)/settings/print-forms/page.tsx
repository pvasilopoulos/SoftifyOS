import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { listPrintForms } from "@/modules/print-forms/service";
import { PrintFormsClient } from "./print-forms-client";

export const metadata = { title: "Φόρμες εκτύπωσης" };
export const dynamic = "force-dynamic";

export default async function PrintFormsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "OWNER" && session.role !== "ADMIN") redirect("/settings");

  const items = await listPrintForms(prisma, session.tenantId);

  return (
    <PrintFormsClient
      initialItems={items.map((f) => ({
        id: f.id,
        code: f.code,
        name: f.name,
        documentKind: f.documentKind,
        paper: f.paper,
        orientation: f.orientation,
        bodyJson: f.bodyJson,
        isDefault: f.isDefault,
        isSystem: f.isSystem,
        isActive: f.isActive,
      }))}
    />
  );
}
