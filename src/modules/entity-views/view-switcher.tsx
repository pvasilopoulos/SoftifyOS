"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, LayoutList } from "lucide-react";
import { cn } from "@/shared/lib/cn";

export type ViewOption = {
  id: string;
  code: string;
  name: string;
  isDefault?: boolean;
};

export function ViewSwitcher({
  label = "Λίστα",
  views,
  value,
  onChange,
  className,
}: {
  label?: string;
  views: ViewOption[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const selected = views.find((v) => v.id === value) ?? views[0];

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (views.length <= 1) return null;

  return (
    <div ref={rootRef} className={cn("relative inline-flex", className)}>
      <button
        type="button"
        aria-label={`${label}: ${selected?.name ?? ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        title={`${label}: ${selected?.name ?? ""}`}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200/80 bg-white/80 text-slate-500 transition",
          "hover:border-slate-300 hover:bg-white hover:text-slate-800",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/30",
          open && "border-teal-300 bg-teal-50 text-teal-800",
        )}
      >
        <LayoutList size={16} strokeWidth={1.75} />
      </button>

      {open ? (
        <div
          id={menuId}
          role="listbox"
          aria-label={label}
          className="absolute right-0 top-[calc(100%+6px)] z-40 min-w-[220px] max-w-[min(320px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg shadow-slate-900/10"
        >
          <div className="border-b border-slate-100 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            {label}
          </div>
          {views.map((v) => {
            const active = v.id === value;
            return (
              <button
                key={v.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(v.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition",
                  active
                    ? "bg-teal-50/80 text-teal-950"
                    : "text-slate-700 hover:bg-slate-50",
                )}
              >
                <Check
                  size={14}
                  className={cn(
                    "mt-0.5 shrink-0",
                    active ? "text-teal-700 opacity-100" : "opacity-0",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{v.name}</span>
                  {v.isDefault ? (
                    <span className="block text-[11px] text-slate-400">
                      προεπιλογή
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function ViewTabs({
  views,
  value,
  onChange,
}: {
  views: ViewOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  if (views.length <= 1) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {views.map((v) => (
        <button
          key={v.id}
          type="button"
          onClick={() => onChange(v.id)}
          className={cn(
            "rounded-full border px-3 py-1.5 text-xs font-medium transition",
            value === v.id
              ? "border-teal-600 bg-teal-600 text-white"
              : "border-slate-200 bg-white text-slate-600 hover:border-teal-200",
          )}
        >
          {v.name}
        </button>
      ))}
    </div>
  );
}
