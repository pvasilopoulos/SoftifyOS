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
    <div className="fixed inset-0 z-50 flex justify-end bg-ink-950/25 backdrop-blur-[1px]">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Κλείσιμο"
        onClick={onClose}
      />
      <aside
        className={cn(
          "relative flex h-full w-full flex-col border-l border-slate-200/80 bg-white shadow-xl animate-fade-in",
          widthClass,
        )}
      >
        <div className="flex items-start gap-3 border-b border-slate-100 px-4 py-3.5 sm:px-5">
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex items-center gap-2.5">
              <h2 className="truncate text-[15px] font-semibold leading-none tracking-tight text-ink-950">
                {title}
              </h2>
              {headerExtra ? (
                <div className="shrink-0 leading-none">{headerExtra}</div>
              ) : null}
            </div>
            {subtitle ? (
              <p className="mt-1.5 text-xs leading-snug text-slate-500">
                {subtitle}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Κλείσιμο"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 sm:px-5">{children}</div>
        {footer ? (
          <div className="border-t border-slate-100 px-4 py-3 sm:px-5">
            {footer}
          </div>
        ) : null}
      </aside>
    </div>
  );
}
