"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  BookOpen,
  Cable,
  ClipboardList,
  LayoutDashboard,
  Package,
  Search,
  Settings,
  ShoppingCart,
  Truck,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/cn";
import {
  PRODUCT_DOC_SECTIONS,
  type DocBlock,
  type DocSectionId,
} from "@/modules/docs/product-guide";

const ICONS: Record<DocSectionId, typeof BookOpen> = {
  overview: LayoutDashboard,
  platform: Settings,
  sales: ShoppingCart,
  customers: Users,
  inventory: Package,
  purchasing: Truck,
  finance: Wallet,
  hr: UserRound,
  retail: ClipboardList,
  integrations: Cable,
  workflows: BookOpen,
  api: Cable,
};

function renderBlock(block: DocBlock, idx: number) {
  if (block.type === "p") {
    return (
      <p key={idx} className="text-sm leading-relaxed text-slate-700">
        {block.text}
      </p>
    );
  }
  if (block.type === "ul") {
    return (
      <ul
        key={idx}
        className="list-inside list-disc space-y-1.5 text-sm text-slate-700"
      >
        {block.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }
  if (block.type === "ol") {
    return (
      <ol
        key={idx}
        className="list-inside list-decimal space-y-1.5 text-sm text-slate-700"
      >
        {block.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>
    );
  }
  if (block.type === "callout") {
    const tones = {
      info: "border-sky-200 bg-sky-50 text-sky-950",
      tip: "border-teal-200 bg-teal-50 text-teal-950",
      warn: "border-amber-200 bg-amber-50 text-amber-950",
    } as const;
    const labels = { info: "Σημείωση", tip: "Tip", warn: "Προσοχή" } as const;
    return (
      <div
        key={idx}
        className={cn("rounded-xl border px-3 py-2.5 text-sm", tones[block.tone])}
      >
        <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
          {labels[block.tone]}
        </p>
        <p className="mt-0.5">{block.text}</p>
      </div>
    );
  }
  if (block.type === "steps") {
    return (
      <div key={idx} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {block.title}
        </p>
        <ol className="mt-2 space-y-2">
          {block.items.map((item, i) => (
            <li key={item} className="flex gap-3 text-sm text-slate-700">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--docs-ink)] text-[11px] font-semibold text-white">
                {i + 1}
              </span>
              <span className="pt-0.5">{item}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  }
  return (
    <dl
      key={idx}
      className="overflow-hidden rounded-2xl border border-slate-100 divide-y divide-slate-100"
    >
      {block.rows.map((row) => (
        <div
          key={row.k}
          className="grid gap-1 bg-white px-3 py-2.5 sm:grid-cols-[160px_minmax(0,1fr)]"
        >
          <dt className="text-xs font-semibold text-slate-500">{row.k}</dt>
          <dd className="text-sm text-slate-800">{row.v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DocsClient() {
  const [sectionId, setSectionId] = useState<DocSectionId>("overview");
  const [q, setQ] = useState("");

  const groups = useMemo(() => {
    const map = new Map<string, typeof PRODUCT_DOC_SECTIONS>();
    for (const s of PRODUCT_DOC_SECTIONS) {
      const list = map.get(s.group) ?? [];
      list.push(s);
      map.set(s.group, list);
    }
    return Array.from(map.entries());
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return PRODUCT_DOC_SECTIONS;
    return PRODUCT_DOC_SECTIONS.filter((s) => {
      const hay = [
        s.title,
        s.subtitle,
        ...s.blocks.flatMap((b) => {
          if (b.type === "p" || b.type === "callout") return [b.text];
          if (b.type === "ul" || b.type === "ol") return b.items;
          if (b.type === "steps") return [b.title, ...b.items];
          return b.rows.flatMap((r) => [r.k, r.v]);
        }),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [q]);

  const section =
    filtered.find((s) => s.id === sectionId) ??
    filtered[0] ??
    PRODUCT_DOC_SECTIONS[0]!;

  return (
    <div className="docs-hub space-y-4">
      <style jsx global>{`
        .docs-hub {
          --docs-ink: #0c1b2a;
          --docs-accent: #0f766e;
        }
        .docs-hero {
          background:
            radial-gradient(900px 260px at 0% 0%, rgba(15, 118, 110, 0.12), transparent 55%),
            linear-gradient(180deg, #eef6f5 0%, #f8fafc 70%);
          border: 1px solid rgba(15, 118, 110, 0.12);
        }
      `}</style>

      <div className="docs-hero rounded-[1.75rem] px-5 py-5 sm:px-6">
        <PageHeader
          title="Docs"
          description="Τι κάνει το SoftifyOS και πώς δουλεύει κάθε ενότητα — οδηγός για χρήστες και διαχειριστές"
          actions={
            <div className="flex flex-wrap gap-2">
              <Link
                href="/settings/integrations"
                className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white/90 px-3 text-sm font-medium hover:bg-white"
              >
                API endpoints
              </Link>
              <Link
                href="/settings"
                className="inline-flex h-9 items-center rounded-xl bg-[var(--docs-ink)] px-3 text-sm font-medium text-white"
              >
                Ρυθμίσεις
              </Link>
            </div>
          }
        />
        <div className="relative mt-4 max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Αναζήτηση: myDATA, άδειες, ισοζύγιο, αποθήκη…"
            className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm shadow-sm"
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge tone="teal">{PRODUCT_DOC_SECTIONS.length} ενότητες</Badge>
          <Badge tone="slate">Ελληνικό ERP</Badge>
          <Badge tone="slate">ΑΑΔΕ · Εργάνη · FI</Badge>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav className="soft-panel h-fit space-y-4 p-3 lg:sticky lg:top-20">
          {groups.map(([group, items]) => (
            <div key={group}>
              <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                {group}
              </p>
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const Icon = ICONS[item.id];
                  const active = section.id === item.id;
                  const hidden = q.trim() && !filtered.some((f) => f.id === item.id);
                  if (hidden) return null;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setSectionId(item.id)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm font-medium transition",
                          active
                            ? "bg-[var(--docs-ink)] text-white shadow-md shadow-slate-900/10"
                            : "text-slate-600 hover:bg-slate-100",
                        )}
                      >
                        <Icon className="h-3.5 w-3.5 opacity-80" />
                        {item.title}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <article className="soft-panel min-w-0 space-y-4 p-5 sm:p-6">
          {filtered.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-500">
              Κανένα αποτέλεσμα για «{q}». Δοκίμασε άλλη λέξη.
            </p>
          ) : (
            <>
              <header>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-teal-800">
                  {section.group}
                </p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight text-ink-950">
                  {section.title}
                </h2>
                <p className="mt-1 text-sm text-slate-500">{section.subtitle}</p>
              </header>
              <div className="space-y-4">
                {section.blocks.map((b, i) => renderBlock(b, i))}
              </div>
              <footer className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                {section.id === "api" || section.id === "integrations" ? (
                  <Link
                    href="/settings/integrations"
                    className="text-sm font-medium text-teal-700 hover:underline"
                  >
                    Άνοιγμα Integrations / API docs →
                  </Link>
                ) : null}
                {section.id === "finance" ? (
                  <Link
                    href="/finance"
                    className="text-sm font-medium text-teal-700 hover:underline"
                  >
                    Άνοιγμα Οικονομικών →
                  </Link>
                ) : null}
                {section.id === "hr" ? (
                  <Link
                    href="/hr"
                    className="text-sm font-medium text-teal-700 hover:underline"
                  >
                    Άνοιγμα HR →
                  </Link>
                ) : null}
                {section.id === "sales" ? (
                  <Link
                    href="/invoices"
                    className="text-sm font-medium text-teal-700 hover:underline"
                  >
                    Άνοιγμα τιμολογίων →
                  </Link>
                ) : null}
              </footer>
            </>
          )}
        </article>
      </div>
    </div>
  );
}
