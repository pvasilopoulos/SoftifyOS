"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Building2,
  Download,
  FileText,
  KeyRound,
  Layers,
  ListChecks,
  Menu,
  Package,
  Plug,
  Printer,
  Ruler,
  ScrollText,
  Search,
  Shield,
  Users,
  UserCog,
  UsersRound,
  Wallet,
  Workflow,
} from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/cn";

type BadgeTone = "teal" | "amber" | "slate" | "rose" | "emerald";

type SettingsLink = {
  href: string;
  title: string;
  description: string;
  badge: string;
  tone: BadgeTone;
  icon: keyof typeof ICONS;
  keywords?: string;
  action?: "export";
};

type SettingsSection = {
  id: string;
  title: string;
  description: string;
  items: SettingsLink[];
};

const ICONS = {
  Building2,
  Menu,
  Users,
  UserCog,
  UsersRound,
  Shield,
  Wallet,
  Printer,
  BookOpen,
  Ruler,
  Layers,
  ListChecks,
  Workflow,
  FileText,
  ScrollText,
  Plug,
  Download,
  Package,
  KeyRound,
  BarChart3,
};

/** Sections sized for even 2-column rows (no orphan empty cells). */
const SECTIONS: SettingsSection[] = [
  {
    id: "org",
    title: "Οργανισμός",
    description: "Εταιρεία, μενού, integrations και αντίγραφα ασφαλείας",
    items: [
      {
        href: "/settings/organization",
        title: "Στοιχεία εταιρείας",
        description: "Επωνυμία, ΑΦΜ, νόμισμα, locale και maintenance mode.",
        badge: "Tenant",
        tone: "teal",
        icon: "Building2",
        keywords: "εταιρεία αφμ vat currency locale",
      },
      {
        href: "/settings/menu",
        title: "Μενού πλοήγησης",
        description:
          "Δομή sidebar, διαθέσιμες επιλογές και footer κινητού (ανά user/ομάδα).",
        badge: "Παραμετρικό",
        tone: "teal",
        icon: "Menu",
        keywords: "menu πλοήγηση footer mobile",
      },
      {
        href: "/settings/integrations",
        title: "API & Integrations",
        description: "Webhooks, myDATA περιβάλλον και εξωτερικές συνδέσεις.",
        badge: "Platform",
        tone: "slate",
        icon: "Plug",
        keywords: "webhook api skroutz mydata",
      },
      {
        href: "/api/settings/export",
        title: "Εξαγωγή ρυθμίσεων",
        description: "JSON snapshot ρυθμίσεων (χωρίς secrets).",
        badge: "Backup",
        tone: "amber",
        icon: "Download",
        keywords: "export backup json download",
        action: "export",
      },
    ],
  },
  {
    id: "iam",
    title: "Ασφάλεια & Πρόσβαση",
    description: "Χρήστες, ρόλοι, ομάδες και audit",
    items: [
      {
        href: "/settings/users",
        title: "Χρήστες",
        description: "Μέλη tenant, ρόλοι και App Role.",
        badge: "IAM",
        tone: "emerald",
        icon: "Users",
      },
      {
        href: "/settings/roles",
        title: "Ρόλοι",
        description: "Granular permissions ανά λειτουργία ERP.",
        badge: "IAM",
        tone: "emerald",
        icon: "UserCog",
      },
      {
        href: "/settings/groups",
        title: "Ομάδες χρηστών",
        description: "Ομαδοποίηση μελών και ανάθεση ρόλων.",
        badge: "IAM",
        tone: "emerald",
        icon: "UsersRound",
      },
      {
        href: "/settings/permissions",
        title: "Permissions",
        description: "Κατάλογος δικαιωμάτων για ρόλους.",
        badge: "IAM",
        tone: "emerald",
        icon: "Shield",
      },
      {
        href: "/settings/audit",
        title: "Καταγραφή ενεργειών",
        description: "Ιστορικό ενεργειών — ποιος άλλαξε τι και πότε.",
        badge: "Ασφάλεια",
        tone: "rose",
        icon: "ScrollText",
        keywords: "audit log ιστορικό",
      },
      {
        href: "/finance",
        title: "Οικονομικά / myDATA",
        description: "AR/AP, ΦΠΑ και ουρά διαβίβασης myDATA.",
        badge: "Live",
        tone: "teal",
        icon: "BarChart3",
        keywords: "finance vat mydata",
      },
    ],
  },
  {
    id: "docs",
    title: "Παραστατικά & Πληρωμές",
    description: "Σειρές, πληρωμές, εκτυπώσεις και λογιστικό σχέδιο",
    items: [
      {
        href: "/settings/series",
        title: "Σειρές & Τύποι",
        description: "Αρίθμηση, myDATA και φόρμες ανά σειρά.",
        badge: "Κρίσιμο",
        tone: "amber",
        icon: "FileText",
        keywords: "series αρίθμηση mydata",
      },
      {
        href: "/settings/payment-methods",
        title: "Τρόποι πληρωμής",
        description: "POS & εισπράξεις, GL λογαριασμοί και IBAN.",
        badge: "Παραμετρικό",
        tone: "teal",
        icon: "Wallet",
      },
      {
        href: "/settings/order-statuses",
        title: "Καταστάσεις παραγγελίας",
        description: "Πρόχειρη, επιβεβαιωμένη και δικές σου ετικέτες.",
        badge: "Παραμετρικό",
        tone: "teal",
        icon: "ListChecks",
        keywords: "order status κατάσταση παραγγελία",
      },
      {
        href: "/settings/invoice-statuses",
        title: "Καταστάσεις τιμολογίου",
        description: "Πρόχειρο, έκδοση τώρα και δικές σου ετικέτες.",
        badge: "Παραμετρικό",
        tone: "teal",
        icon: "ListChecks",
        keywords: "invoice status κατάσταση τιμολόγιο έκδοση",
      },
      {
        href: "/settings/document-transforms",
        title: "Μετασχηματισμοί",
        description:
          "Τι μετατρέπεται σε τι, μερική κάλυψη γραμμών και υπόλοιπα.",
        badge: "Advanced",
        tone: "amber",
        icon: "Workflow",
        keywords: "transform μετασχηματισμός convert quote order invoice delivery",
      },
      {
        href: "/settings/print-forms",
        title: "Φόρμες εκτύπωσης",
        description: "Print Form Builder για τιμολόγια και ΑΠΥ.",
        badge: "Παραμετρικό",
        tone: "teal",
        icon: "Printer",
      },
      {
        href: "/settings/gl-accounts",
        title: "Λογιστικό σχέδιο",
        description: "Λογαριασμοί γενικής λογιστικής.",
        badge: "Λογιστική",
        tone: "emerald",
        icon: "BookOpen",
      },
    ],
  },
  {
    id: "platform",
    title: "Πλατφόρμα",
    description: "Μονάδες, προβολές, scripts και αποθήκη",
    items: [
      {
        href: "/settings/units",
        title: "Μονάδες μέτρησης",
        description: "τεμ, kg, lt… σύμβολο και δεκαδικά.",
        badge: "Παραμετρικό",
        tone: "teal",
        icon: "Ruler",
      },
      {
        href: "/settings/entity-views",
        title: "Πεδία & Προβολές",
        description: "Custom fields, λίστες και φόρμες.",
        badge: "Platform",
        tone: "slate",
        icon: "Layers",
      },
      {
        href: "/settings/scripts",
        title: "Script Hooks",
        description: "JS hooks, sandbox, allow-list και secrets.",
        badge: "Platform",
        tone: "slate",
        icon: "Workflow",
      },
      {
        href: "/inventory",
        title: "Αποθήκη",
        description: "Υπόλοιπα, κινήσεις και προσαρμογές.",
        badge: "Ops",
        tone: "slate",
        icon: "Package",
      },
    ],
  },
];

export function SettingsHubClient({
  tenantName,
  maintenanceMode,
}: {
  tenantName: string;
  maintenanceMode: boolean;
}) {
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query.trim().toLowerCase());

  const filtered = useMemo(() => {
    if (!deferred) return SECTIONS;
    return SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        const hay = [
          item.title,
          item.description,
          item.badge,
          item.keywords ?? "",
          section.title,
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(deferred);
      }),
    })).filter((s) => s.items.length > 0);
  }, [deferred]);

  const total = SECTIONS.reduce((n, s) => n + s.items.length, 0);
  const shown = filtered.reduce((n, s) => n + s.items.length, 0);

  return (
    <div className="space-y-5">
      {maintenanceMode ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Το <strong>maintenance mode</strong> είναι ενεργό — οι μη-διαχειριστές
          βλέπουν ειδοποίηση συντήρησης.
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-lg">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Αναζήτηση ρυθμίσεων…"
            className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none placeholder:text-slate-400 focus:border-teal-300 focus:ring-2 focus:ring-teal-500/20"
          />
        </div>
        <p className="shrink-0 text-xs text-slate-500">
          {tenantName} · {shown}/{total}
        </p>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500">
          Καμία ρύθμιση δεν ταιριάζει με «{query}».
        </div>
      ) : null}

      {filtered.map((section) => (
        <section key={section.id} className="space-y-2.5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {section.title}
            </h2>
            <p className="text-xs text-slate-400">{section.description}</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {section.items.map((item) => {
              const Icon = ICONS[item.icon] ?? KeyRound;
              const className = cn(
                "group soft-panel flex h-full gap-3 p-4 transition",
                "hover:border-teal-300 hover:bg-teal-50/40",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40",
              );

              const body = (
                <>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-teal-700 transition group-hover:bg-teal-100">
                    <Icon size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-ink-950">{item.title}</h3>
                      <Badge tone={item.tone}>{item.badge}</Badge>
                      <ArrowRight
                        size={14}
                        className="ml-auto text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-teal-600"
                      />
                    </div>
                    <p className="text-sm leading-snug text-slate-600">
                      {item.description}
                    </p>
                  </div>
                </>
              );

              if (item.action === "export") {
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    className={className}
                    download
                  >
                    {body}
                  </a>
                );
              }

              return (
                <Link key={item.href} href={item.href} className={className}>
                  {body}
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
