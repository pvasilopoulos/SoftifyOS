import Link from "next/link";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";

export const metadata = { title: "Ρυθμίσεις" };

const links = [
  {
    href: "/settings/menu",
    title: "Μενού πλοήγησης",
    description:
      "Drag & drop δομή, διαθέσιμες επιλογές και footer μενού για mobile.",
    badge: "Παραμετρικό",
  },
  {
    href: "/settings/users",
    title: "Χρήστες",
    description: "Μέλη tenant, ρόλος συστήματος και σύνδεση με custom ρόλο.",
    badge: "IAM",
  },
  {
    href: "/settings/roles",
    title: "Ρόλοι",
    description: "App roles με granular permissions για λειτουργίες του ERP.",
    badge: "IAM",
  },
  {
    href: "/settings/groups",
    title: "Ομάδες χρηστών",
    description: "Ομαδοποίηση μελών και ανάθεση ρόλων σε ομάδες.",
    badge: "IAM",
  },
  {
    href: "/settings/permissions",
    title: "Permissions",
    description: "Κατάλογος δικαιωμάτων που μπορούν να ανατεθούν σε ρόλους.",
    badge: "IAM",
  },
  {
    href: "/settings/payment-methods",
    title: "Τρόποι πληρωμής",
    description:
      "Παραμετρικοί τρόποι για POS & εισπράξεις, με λογιστικούς λογαριασμούς και IBAN.",
    badge: "Παραμετρικό",
  },
  {
    href: "/settings/units",
    title: "Μονάδες μέτρησης",
    description:
      "Κατάλογος μονάδων (τεμ, kg, lt…) για προϊόντα — σύμβολο, δεκαδικά, προεπιλογή.",
    badge: "Παραμετρικό",
  },
  {
    href: "/settings/series",
    title: "Σειρές & Τύποι",
    description:
      "Αρίθμηση παραστατικών, υποκατάστημα/ταμείο, κινήσεις πελάτη & αποθήκης, myDATA.",
    badge: "Κρίσιμο",
  },
];

export default function SettingsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Ρυθμίσεις"
        description="Παραμετροποίηση tenant, μενού και δικαιωμάτων"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="soft-panel block p-5 transition hover:border-teal-200 hover:bg-teal-50/40"
          >
            <div className="mb-2 flex items-center gap-2">
              <h2 className="font-semibold text-ink-950">{link.title}</h2>
              <Badge tone="teal">{link.badge}</Badge>
            </div>
            <p className="text-sm text-slate-600">{link.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
