import Link from "next/link";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";

export const metadata = { title: "Ρυθμίσεις" };

const links = [
  {
    href: "/settings/series",
    title: "Σειρές & Τύποι",
    description:
      "Αρίθμηση παραστατικών, υποκατάστημα/ταμείο, κινήσεις πελάτη & αποθήκης, myDATA, λογιστικά άρθρα.",
    badge: "Κρίσιμο",
  },
];

export default function SettingsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Ρυθμίσεις"
        description="Παραμετροποίηση tenant και παραστατικών"
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
