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
  headerExtra,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  widthClass?: string;
  footer?: React.ReactNode;
  headerExtra?: React.ReactNode;
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
        <div className="flex items-center justify-between gap-3 border-b border-slate-200/80 px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold tracking-tight text-ink-950 sm:text-lg">
                {title}
              </h2>
              {headerExtra}
            </div>
            {subtitle ? (
              <p className="mt-0.5 truncate text-sm text-slate-500">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-ink-900"
            aria-label="Κλείσιμο"
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
