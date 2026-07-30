"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { quickActions } from "@/platform/navigation";
import { cn } from "@/shared/lib/cn";

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const activeQuery = open ? query : "";

  const results = useMemo(() => {
    const q = activeQuery.trim().toLowerCase();
    if (!q) return quickActions;
    return quickActions.filter((a) => a.label.toLowerCase().includes(q));
  }, [activeQuery]);

  useEffect(() => {
    function handleClose() {
      setQuery("");
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) handleClose();
        else document.dispatchEvent(new CustomEvent("softify:open-command"));
      }
      if (e.key === "Escape" && open) handleClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function close() {
    setQuery("");
    onClose();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink-950/40 p-4 pt-[12vh] backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-ink-950/20"
      >
        <div className="flex items-center gap-3 border-b border-slate-100 px-4">
          <Search size={18} className="text-slate-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Αναζήτηση εντολών, πελατών, παραστατικών..."
            className="h-14 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
          <button
            type="button"
            onClick={close}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
            aria-label="Κλείσιμο"
          >
            <X size={16} />
          </button>
        </div>
        <ul className="max-h-80 overflow-y-auto p-2">
          {results.map((action, idx) => (
            <li key={action.id}>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm hover:bg-teal-50",
                  idx === 0 && !query && "bg-teal-50",
                )}
                onClick={() => {
                  close();
                  router.push(action.href);
                }}
              >
                <span className="font-medium text-ink-900">{action.label}</span>
                <kbd className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-500">
                  {action.shortcut}
                </kbd>
              </button>
            </li>
          ))}
          {results.length === 0 ? (
            <li className="px-3 py-8 text-center text-sm text-slate-500">
              Δεν βρέθηκαν αποτελέσματα
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
