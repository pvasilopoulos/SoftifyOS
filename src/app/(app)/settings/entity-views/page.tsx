import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import {
  ensureEntityViewDefaults,
  listCustomFields,
  listEntityFormViews,
  listEntityListViews,
  serializeFormView,
  serializeListView,
} from "@/modules/entity-views/service";
import { ENTITY_MODULES } from "@/modules/entity-views/registry";
import { EntityViewsClient } from "./entity-views-client";

export const metadata = { title: "Πεδία & Προβολές" };
export const dynamic = "force-dynamic";

export default async function EntityViewsSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "OWNER" && session.role !== "ADMIN") {
    redirect("/settings");
  }

  await ensureEntityViewDefaults(prisma, session.tenantId);

  const [fields, ...viewBundles] = await Promise.all([
    listCustomFields(prisma, session.tenantId),
    ...ENTITY_MODULES.map(async (entity) => ({
      entity,
      lists: (await listEntityListViews(prisma, session.tenantId, entity, false)).map(
        serializeListView,
      ),
      forms: (await listEntityFormViews(prisma, session.tenantId, entity, false)).map(
        serializeFormView,
      ),
    })),
  ]);

  const byEntity = Object.fromEntries(
    viewBundles.map((b) => [b.entity, { lists: b.lists, forms: b.forms }]),
  ) as Record<
    string,
    {
      lists: ReturnType<typeof serializeListView>[];
      forms: ReturnType<typeof serializeFormView>[];
    }
  >;

  return (
    <EntityViewsClient
      initialFields={fields.map((f) => ({
        id: f.id,
        entity: f.entity,
        code: f.code,
        label: f.label,
        type: f.type,
        options: Array.isArray(f.optionsJson)
          ? f.optionsJson.map(String)
          : [],
        required: f.required,
        filterable: f.filterable,
        showInList: f.showInList,
        sortOrder: f.sortOrder,
        isActive: f.isActive,
      }))}
      initialViews={byEntity}
    />
  );
}
