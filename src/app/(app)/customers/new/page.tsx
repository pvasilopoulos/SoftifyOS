import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import {
  listCustomFields,
  listEntityFormViews,
  serializeFormView,
} from "@/modules/entity-views/service";
import { NewCustomerForm } from "./new-customer-form";

export const metadata = { title: "Νέος πελάτης" };
export const dynamic = "force-dynamic";

export default async function NewCustomerPage({
  searchParams,
}: {
  searchParams: Promise<{ form?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const sp = await searchParams;

  const [forms, customFields] = await Promise.all([
    listEntityFormViews(prisma, session.tenantId, "CUSTOMERS", true),
    listCustomFields(prisma, session.tenantId, "CUSTOMERS", true),
  ]);

  const serialized = forms.map(serializeFormView);
  const initial =
    serialized.find((f) => f.id === sp.form || f.code === sp.form) ??
    serialized.find((f) => f.isDefault) ??
    serialized[0] ??
    null;

  return (
    <NewCustomerForm
      formViews={serialized}
      initialFormId={initial?.id ?? ""}
      role={session.role}
      customFields={customFields.map((f) => ({
        code: f.code,
        label: f.label,
        type: f.type,
        optionsJson: f.optionsJson,
        required: f.required,
      }))}
    />
  );
}
