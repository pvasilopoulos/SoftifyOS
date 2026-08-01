"use client";

import { useEffect, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Save } from "lucide-react";
import type { EntityModule } from "@/generated/prisma/client";
import { Button } from "@/shared/ui/button";
import {
  entitySupportsDetailTabs,
  type DetailLayoutConfig,
  type DetailTabDef,
} from "@/modules/entity-views/detail-tabs";

export function DetailTabsPanel({
  entity,
  initialConfig,
  onSaved,
}: {
  entity: EntityModule;
  initialConfig: DetailLayoutConfig | null;
  onSaved?: (config: DetailLayoutConfig) => void;
}) {
  const [tabs, setTabs] = useState<DetailTabDef[]>(
    initialConfig?.tabs ?? [],
  );
  const [defaultTab, setDefaultTab] = useState<string>(
    initialConfig?.defaultTab ?? tabs[0]?.key ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setTabs(initialConfig?.tabs ?? []);
    setDefaultTab(
      initialConfig?.defaultTab ?? initialConfig?.tabs[0]?.key ?? "",
    );
    setError(null);
    setMessage(null);
  }, [entity, initialConfig]);

  if (!entitySupportsDetailTabs(entity)) {
    return (
      <div className="soft-panel px-4 py-10 text-center text-sm text-slate-500">
        Η οντότητα δεν έχει ακόμα παραμετρικά detail tabs. Διατίθεται για
        Πελάτες.
      </div>
    );
  }

  function move(index: number, dir: -1 | 1) {
    setTabs((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      const tmp = next[index]!;
      next[index] = next[target]!;
      next[target] = tmp;
      return next;
    });
  }

  function save() {
    startTransition(async () => {
      setError(null);
      setMessage(null);
      try {
        const res = await fetch("/api/settings/detail-layouts", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entity,
            config: {
              tabs: tabs.map((t) => ({
                key: t.key,
                label: t.label,
                visible: t.visible,
              })),
              defaultTab: defaultTab || undefined,
            },
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Αποτυχία");
        setTabs(data.config.tabs);
        setDefaultTab(data.config.defaultTab ?? "");
        setMessage("Η σειρά tabs αποθηκεύτηκε");
        onSaved?.(data.config);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Σφάλμα");
      }
    });
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink-950">
            Σειρά tabs σελίδας λεπτομερειών
          </h2>
          <p className="text-xs text-slate-500">
            Σύρετε με τα βέλη τη σειρά εμφάνισης και ενεργοποιήστε/απενεργοποιήστε
            tabs.
          </p>
        </div>
        <Button size="sm" disabled={pending} onClick={save}>
          <Save size={14} />
          Αποθήκευση
        </Button>
      </div>

      {error ? (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-xl bg-teal-50 px-3 py-2 text-sm text-teal-900">
          {message}
        </p>
      ) : null}

      <ul className="soft-panel divide-y divide-slate-100 overflow-hidden">
        {tabs.map((tab, index) => (
          <li
            key={tab.key}
            className="flex flex-wrap items-center gap-3 px-4 py-3"
          >
            <span className="w-6 text-center text-xs font-medium text-slate-400">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <input
                value={tab.label}
                onChange={(e) =>
                  setTabs((prev) =>
                    prev.map((t, i) =>
                      i === index ? { ...t, label: e.target.value } : t,
                    ),
                  )
                }
                className="h-9 w-full max-w-xs rounded-lg border border-slate-200 px-2.5 text-sm outline-none focus:border-teal-300"
              />
              <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                {tab.key}
              </p>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={tab.visible}
                onChange={(e) =>
                  setTabs((prev) =>
                    prev.map((t, i) =>
                      i === index ? { ...t, visible: e.target.checked } : t,
                    ),
                  )
                }
              />
              Ορατό
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input
                type="radio"
                name="defaultTab"
                checked={defaultTab === tab.key}
                disabled={!tab.visible}
                onChange={() => setDefaultTab(tab.key)}
              />
              Προεπιλογή
            </label>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="secondary"
                type="button"
                disabled={index === 0 || pending}
                onClick={() => move(index, -1)}
              >
                <ArrowUp size={14} />
              </Button>
              <Button
                size="sm"
                variant="secondary"
                type="button"
                disabled={index === tabs.length - 1 || pending}
                onClick={() => move(index, 1)}
              >
                <ArrowDown size={14} />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
