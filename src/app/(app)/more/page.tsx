import Link from "next/link";
import { navGroups } from "@/platform/navigation";
import { PageHeader } from "@/shared/ui/page-header";

export const metadata = { title: "Περισσότερα" };

export default function MorePage() {
  const extra = navGroups.flatMap((g) => g.items).filter((i) => !i.mobileTab);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Περισσότερα"
        description="Modules και ρυθμίσεις · mobile hub"
      />
      <ul className="soft-panel divide-y divide-slate-100 overflow-hidden">
        {extra.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className="flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                  <Icon size={18} />
                </span>
                <span className="text-sm font-medium text-ink-900">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
