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
  Workflow,
  FileText,
  ScrollText,
  Plug,
  Download,
  Package,
  KeyRound,
  BarChart3,
};

const SECTIONS: SettingsSection[] = [
  {
    id: "org",
    title: "Οργανισμός",
    description: "Στοιχεία εταιρείας, τοπικοποίηση και συντήρηση",
    items: [
      {
        href: "/settings/organization",
        title: "Στοιχεία εταιρείας",
        description:
          "Επωνυμία, ΑΦΜ, διεύθυνση, νόμισμα, γλώσσα, timezone και maintenance mode.",
        badge: "Tenant",
        tone: "teal",
        icon: "Building2",
        keywords: "εταιρεία αφμ vat currency locale",
      },
      {
        href: "/settings/integrations",
        title: "API & Integrations",
        description:
          "Webhooks, myDATA περιβάλλον, marketplace hooks και διαθέσιμα endpoints.",
        badge: "Platform",
        tone: "slate",
        icon: "Plug",
        keywords: "webhook api skroutz mydata",
      },
      {
        href: "/api/settings/export",
        title: "Εξαγωγή ρυθμίσεων",
        description:
          "Κατέβασμα JSON snapshot (σειρές, GL, ρόλοι, μονάδες) χωρίς secrets.",
        badge: "Backup",
        tone: "amber",
        icon: "Download",
        keywords: "export backup json download",
        action: "export",
      },
      {
        href: "/audit",
        title: "Audit log",
        description:
          "Ποιος άλλαξε τι και πότε — πλήρες ιστορικό ενεργειών του tenant.",
        badge: "Ασφάλεια",
        tone: "rose",
        icon: "ScrollText",
        keywords: "audit log ιστορικό",
      },
    ],
  },
  {
    id: "iam",
    title: "Ασφάλεια & Πρόσβαση",
    description: "Χρήστες, ρόλοι, ομάδες και δικαιώματα",
    items: [
      {
        href: "/settings/users",
        title: "Χρήστες",
        description:
          "Δημιουργία, επεξεργασία και αφαίρεση μελών · ρόλοι και App Role.",
        badge: "IAM",
        tone: "emerald",
        icon: "Users",
      },
      {
        href: "/settings/roles",
        title: "Ρόλοι",
        description: "App roles με granular permissions για λειτουργίες του ERP.",
        badge: "IAM",
        tone: "emerald",
        icon: "UserCog",
      },
      {
        href: "/settings/groups",
        title: "Ομάδες χρηστών",
        description: "Ομαδοποίηση μελών και ανάθεση ρόλων σε ομάδες.",
        badge: "IAM",
        tone: "emerald",
        icon: "UsersRound",
      },
      {
        href: "/settings/permissions",
        title: "Permissions",
        description:
          "Κατάλογος δικαιωμάτων που μπορούν να ανατεθούν σε ρόλους.",
        badge: "IAM",
        tone: "emerald",
        icon: "Shield",
      },
    ],
  },
  {
    id: "docs",
    title: "Παραστατικά & Πληρωμές",
    description: "Σειρές, τρόποι πληρωμής και φόρμες εκτύπωσης",
    items: [
      {
        href: "/settings/series",
        title: "Σειρές & Τύποι",
        description:
          "Αρίθμηση, myDATA, εξοφλήσεις και φόρμες εκτύπωσης ανά σειρά.",
        badge: "Κρίσιμο",
        tone: "amber",
        icon: "FileText",
        keywords: "series αρίθμηση mydata",
      },
      {
        href: "/settings/payment-methods",
        title: "Τρόποι πληρωμής",
        description:
          "Παραμετρικοί τρόποι για POS & εισπράξεις, με λογιστικούς λογαριασμούς και IBAN.",
        badge: "Παραμετρικό",
        tone: "teal",
        icon: "Wallet",
      },
      {
        href: "/settings/print-forms",
        title: "Φόρμες εκτύπωσης",
        description:
          "Print Form Builder — blocks κεφαλίδας, γραμμών και συνόλων για τιμολόγια/ΑΠΥ.",
        badge: "Παραμετρικό",
        tone: "teal",
        icon: "Printer",
      },
      {
        href: "/settings/gl-accounts",
        title: "Λογιστικό σχέδιο",
        description:
          "Λογαριασμοί γενικής λογιστικής για άρθρα ημερολογίου.",
        badge: "Λογιστική",
        tone: "emerald",
        icon: "BookOpen",
      },
    ],
  },
  {
    id: "ops",
    title: "Λειτουργίες",
    description: "Μενού, μονάδες και προβολές δεδομένων",
    items: [
      {
        href: "/settings/menu",
        title: "Μενού πλοήγησης",
        description:
          "Drag & drop δομή, διαθέσιμες επιλογές και footer μενού για mobile.",
        badge: "Παραμετρικό",
        tone: "teal",
        icon: "Menu",
      },
      {
        href: "/settings/units",
        title: "Μονάδες μέτρησης",
        description:
          "Κατάλογος μονάδων (τεμ, kg, lt…) για προϊόντα — σύμβολο, δεκαδικά, προεπιλογή.",
        badge: "Παραμετρικό",
        tone: "teal",
        icon: "Ruler",
      },
      {
        href: "/settings/entity-views",
        title: "Πεδία & Προβολές",
        description:
          "Custom fields ανά module · πολλαπλές λίστες/φόρμες με στήλες, φίλτρα και ενότητες.",
        badge: "Platform",
        tone: "slate",
        icon: "Layers",
      },
      {
        href: "/settings/scripts",
        title: "Script Hooks",
        description:
          "Custom JavaScript ανά event · sandbox · HTTP allow-list & secrets.",
        badge: "Platform",
        tone: "slate",
        icon: "Workflow",
      },
    ],
  },
  {
    id: "quick",
    title: "Γρήγοροι σύνδεσμοι",
    description: "Συχνές λειτουργικές οθόνες",
    items: [
      {
        href: "/finance",
        title: "Οικονομικά / myDATA",
        description: "AR/AP, ΦΠΑ περιόδου και ουρά διαβίβασης myDATA.",
        badge: "Live",
        tone: "teal",
        icon: "BarChart3",
      },
      {
        href: "/inventory",
        title: "Αποθήκη",
        description: "Υπόλοιπα, κινήσεις και προσαρμογές αποθέματος.",
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
    <div className="space-y-6">
      {maintenanceMode ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Το <strong>maintenance mode</strong> είναι ενεργό — οι μη-διαχειριστές
          βλέπουν ειδοποίηση συντήρησης.
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-md">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Αναζήτηση ρυθμίσεων…"
            className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm shadow-sm outline-none ring-teal-500/30 placeholder:text-slate-400 focus:border-teal-300 focus:ring-2"
          />
        </div>
        <p className="text-xs text-slate-500">
          {tenantName} · {shown}/{total} ενότητες
        </p>
      </div>

      {filtered.length === 0 ? (
        <div className="soft-panel px-6 py-16 text-center text-sm text-slate-500">
          Καμία ρύθμιση δεν ταιριάζει με «{query}».
        </div>
      ) : null}

      {filtered.map((section) => (
        <section key={section.id} className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {section.title}
            </h2>
            <p className="text-sm text-slate-500">{section.description}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {section.items.map((item) => {
              const Icon = ICONS[item.icon] ?? KeyRound;
              const className = cn(
                "group soft-panel relative block p-5 transition",
                "hover:-translate-y-0.5 hover:border-teal-300 hover:bg-teal-50/50 hover:shadow-md hover:shadow-teal-900/5",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40",
              );

              const body = (
                <>
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-teal-700 transition group-hover:bg-teal-100">
                      <Icon size={18} />
                    </span>
                    <Badge tone={item.tone}>{item.badge}</Badge>
                  </div>
                  <div className="mb-1.5 flex items-center gap-2">
                    <h3 className="font-semibold text-ink-950">{item.title}</h3>
                    <ArrowRight
                      size={14}
                      className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-teal-600"
                    />
                  </div>
                  <p className="text-sm leading-relaxed text-slate-600">
                    {item.description}
                  </p>
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
