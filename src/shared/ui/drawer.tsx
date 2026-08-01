"use client";

import { X } from "lucide-react";
import { cn } from "@/shared/lib/cn";

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  widthClass = "max-w-md",
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  widthClass?: string;
  footer?: React.ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink-950/30 backdrop-blur-[2px]">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Κλείσιμο"
        onClick={onClose}
      />
      <aside
        className={cn(
          "relative flex h-full w-full flex-col border-l border-slate-200 bg-white shadow-2xl animate-fade-in",
          widthClass,
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {subtitle || "Λεπτομέρειες"}
            </p>
            <h2 className="mt-1 truncate text-lg font-semibold text-ink-950">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-ink-900"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="border-t border-slate-100 px-5 py-3">{footer}</div>
        ) : null}
      </aside>
    </div>
  );
}
