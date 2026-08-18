import { redirect } from "next/navigation";
import { Building2, Layers3, Users } from "lucide-react";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";

export const metadata = { title: "Ρυθμίσεις · Εταιρεία" };
export const dynamic = "force-dynamic";

export default async function CompanySettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [tenant, membershipCount] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: session.tenantId },
      select: { slug: true, name: true, createdAt: true },
    }),
    prisma.membership.count({ where: { tenantId: session.tenantId } }),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Εταιρεία"
        description="Κεντρική ταυτότητα και οργανωτικά στοιχεία tenant"
      />

      <div className="grid gap-3 md:grid-cols-3">
        <StatCard
          icon={<Building2 size={16} />}
          label="Επωνυμία"
          value={tenant?.name ?? session.tenantName}
        />
        <StatCard icon={<Layers3 size={16} />} label="Slug" value={tenant?.slug ?? "-"} />
        <StatCard
          icon={<Users size={16} />}
          label="Χρήστες στην εταιρεία"
          value={String(membershipCount)}
        />
      </div>

      <section className="soft-panel space-y-2 p-5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-ink-950">Λειτουργική κατάσταση</h2>
          <Badge tone="emerald">Active</Badge>
        </div>
        <p className="text-sm text-slate-600">
          Η σελίδα δείχνει συνοπτικά την ενεργή εταιρεία από το session. Στα επόμενα
          βήματα μπορούν να προστεθούν editable στοιχεία εταιρείας (ΑΦΜ, διεύθυνση,
          νόμισμα, ζώνη ώρας, branding).
        </p>
      </section>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="soft-panel p-4">
      <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
        {icon}
        {label}
      </p>
      <p className="text-base font-semibold text-ink-950">{value}</p>
    </div>
  );
}
