import { redirect } from "next/navigation";
import { ShieldCheck, Users } from "lucide-react";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";

export const metadata = { title: "Ρυθμίσεις · Χρήστες & Ρόλοι" };
export const dynamic = "force-dynamic";

const roleTone: Record<string, "teal" | "emerald" | "amber" | "rose" | "slate"> = {
  SUPER_ADMIN: "rose",
  OWNER: "teal",
  ADMIN: "emerald",
  MEMBER: "amber",
  VIEWER: "slate",
};

export default async function UsersSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const memberships = await prisma.membership.findMany({
    where: { tenantId: session.tenantId },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Χρήστες & Ρόλοι"
        description="Δικαιώματα πρόσβασης ανά χρήστη στην τρέχουσα εταιρεία"
      />

      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
        <span className="inline-flex items-center gap-1">
          <Users size={14} /> {memberships.length} ενεργές συμμετοχές
        </span>
        <span className="inline-flex items-center gap-1">
          <ShieldCheck size={14} /> Ρόλος session:{" "}
          <Badge tone={roleTone[session.role] ?? "slate"}>{session.role}</Badge>
        </span>
      </div>

      <section className="soft-panel overflow-hidden">
        <div className="grid grid-cols-[1.2fr_1fr_0.7fr] border-b border-slate-100 px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-400">
          <span>Χρήστης</span>
          <span>Email</span>
          <span>Ρόλος</span>
        </div>
        <ul className="divide-y divide-slate-100">
          {memberships.map((m) => (
            <li key={m.id} className="grid grid-cols-[1.2fr_1fr_0.7fr] items-center gap-2 px-4 py-3 text-sm">
              <span className="font-medium text-ink-950">{m.user.name}</span>
              <span className="text-slate-600">{m.user.email}</span>
              <span>
                <Badge tone={roleTone[m.role] ?? "slate"}>{m.role}</Badge>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
