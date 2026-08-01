"use client";

import { Toaster as Sonner } from "sonner";

export function AppToaster() {
  return (
    <Sonner
      position="top-right"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "rounded-xl border border-slate-200 bg-white text-ink-900 shadow-lg",
          title: "text-sm font-semibold",
          description: "text-xs text-slate-600",
        },
      }}
    />
  );
}

export { toast } from "sonner";
