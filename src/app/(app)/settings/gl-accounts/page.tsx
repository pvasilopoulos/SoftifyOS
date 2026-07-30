import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { listGlAccounts } from "@/modules/ledger/service";
import { GlAccountsClient } from "./gl-accounts-client";

export const metadata = { title: "Λογιστικό σχέδιο" };
export const dynamic = "force-dynamic";

export default async function GlAccountsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "OWNER" && session.role !== "ADMIN") redirect("/settings");

  const items = await listGlAccounts(prisma, session.tenantId);
  return (
    <GlAccountsClient
      initialItems={items.map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        type: a.type,
        parentId: a.parentId,
        isPostable: a.isPostable,
        isSystem: a.isSystem,
        isActive: a.isActive,
      }))}
    />
  );
}
