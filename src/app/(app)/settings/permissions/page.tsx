import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { permissionsByGroup } from "@/platform/auth/permissions";
import { getSession } from "@/platform/auth/session";
import { redirect } from "next/navigation";

export const metadata = { title: "Permissions" };

export default async function PermissionsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "OWNER" && session.role !== "ADMIN") redirect("/settings");

  const groups = permissionsByGroup();

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/settings"
          className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-ink-900"
        >
          <ArrowLeft size={14} /> Ρυθμίσεις
        </Link>
        <PageHeader
          title="Permissions"
          description="Κατάλογος δικαιωμάτων που ανατίθενται σε ρόλους. Η επιβολή στις API θα επεκταθεί σταδιακά."
        />
      </div>

      <div className="space-y-4">
        {groups.map(({ group, items }) => (
          <section key={group} className="soft-panel p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink-950">{group}</h2>
            <ul className="divide-y divide-slate-100">
              {items.map((p) => (
                <li
                  key={p.code}
                  className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm"
                >
                  <span className="font-medium text-ink-900">{p.label}</span>
                  <code className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {p.code}
                  </code>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
