"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-ink-950/30 backdrop-blur-[1px]"
        aria-label="Κλείσιμο"
        onClick={onClose}
      />
      <aside
        className={cn(
          "relative z-[1] flex h-full w-full flex-col border-l border-slate-200/80 bg-white shadow-2xl shadow-ink-950/15 animate-fade-in",
          widthClass,
        )}
        onClick={(e) => e.stopPropagation()}
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
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-5">
          {children}
        </div>
        {footer ? (
          <div className="border-t border-slate-100 px-4 py-3 sm:px-5">
            {footer}
          </div>
        ) : null}
      </aside>
    </div>,
    document.body,
  );
}
