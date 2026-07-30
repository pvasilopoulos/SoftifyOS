import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/shared/ui/page-header";
import { ensureLoyaltyProgram } from "@/modules/loyalty/service";
import { LoyaltyProgramClient } from "./loyalty-program-client";

export const metadata = { title: "Πρόγραμμα Loyalty" };
export const dynamic = "force-dynamic";

export default async function LoyaltyProgramPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "OWNER" && session.role !== "ADMIN") {
    redirect("/loyalty");
  }

  const program = await ensureLoyaltyProgram(prisma, session.tenantId);

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/loyalty"
          className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-ink-900"
        >
          <ArrowLeft size={14} /> Loyalty
        </Link>
        <PageHeader
          title="Πρόγραμμα Loyalty"
          description="Κανόνες κέρδους και εξαργύρωσης πόντων (ισχύουν στο POS)"
        />
      </div>
      <LoyaltyProgramClient
        initial={{
          name: program.name,
          earnPointsPerEur: program.earnPointsPerEur,
          redeemPointsPerEur: program.redeemPointsPerEur,
          isActive: program.isActive,
        }}
      />
    </div>
  );
}
