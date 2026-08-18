import { redirect } from "next/navigation";
import { Shield, ShieldCheck, TimerReset } from "lucide-react";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";

export const metadata = { title: "Ρυθμίσεις · Ασφάλεια" };
export const dynamic = "force-dynamic";

export default async function SecuritySettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const lastAuditEvents = await prisma.auditEvent.count({
    where: { tenantId: session.tenantId },
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Ασφάλεια"
        description="Έλεγχος πρόσβασης και παρακολούθηση λειτουργικής ασφάλειας"
      />

      <div className="grid gap-3 md:grid-cols-3">
        <Item icon={<Shield size={16} />} label="Session διάρκεια" value="7 ημέρες" />
        <Item icon={<ShieldCheck size={16} />} label="Ρόλος τρέχοντος χρήστη" value={session.role} />
        <Item icon={<TimerReset size={16} />} label="Audit events" value={String(lastAuditEvents)} />
      </div>

      <section className="soft-panel p-5">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-ink-950">Security baseline</h2>
          <Badge tone="emerald">Enabled</Badge>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li>HTTP-only session cookie με υπογραφή JWT.</li>
          <li>Role checks στα write endpoints (viewer/member restrictions).</li>
          <li>Audit trail για κρίσιμα events authentication και entities.</li>
        </ul>
      </section>
    </div>
  );
}

function Item({
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
      <p className="text-lg font-semibold text-ink-950">{value}</p>
    </div>
  );
}
