"use client";

import { Bell, Building2, ChevronDown, Search, Zap } from "lucide-react";
import { Button } from "@/shared/ui/button";

export function Topbar({
  onOpenCommand,
  onOpenQuickActions,
}: {
  onOpenCommand: () => void;
  onOpenQuickActions: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-slate-200/80 bg-[#F1F4F7]/90 px-3 backdrop-blur sm:h-16 sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-2 lg:hidden">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-950 text-xs font-bold text-white">
          S
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink-950">SoftifyOS</p>
          <p className="truncate text-[11px] text-slate-500">Ακρόπολις ΑΕ</p>
        </div>
      </div>

      <button
        type="button"
        onClick={onOpenCommand}
        className="hidden min-w-0 flex-1 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-left text-sm text-slate-400 shadow-sm transition hover:border-slate-300 lg:flex"
      >
        <Search size={16} className="shrink-0 text-slate-400" />
        <span className="flex-1 truncate">Αναζήτηση ή εντολή...</span>
        <kbd className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
          ⌘K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="lg:hidden"
          onClick={onOpenQuickActions}
          aria-label="Γρήγορες ενέργειες"
        >
          <Zap size={18} />
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="relative"
          aria-label="Ειδοποιήσεις"
        >
          <Bell size={18} />
          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-teal-500 ring-2 ring-white" />
        </Button>
        <button
          type="button"
          className="hidden items-center gap-2 rounded-2xl border border-slate-200 bg-white px-2.5 py-1.5 text-sm shadow-sm hover:bg-slate-50 md:flex"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-50 text-teal-800">
            <Building2 size={14} />
          </span>
          <span className="max-w-[140px] truncate font-medium text-ink-900">
            Ακρόπολις ΑΕ
          </span>
          <ChevronDown size={14} className="text-slate-400" />
        </button>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-950 text-xs font-semibold text-white">
          ΜΚ
        </div>
      </div>
    </header>
  );
}
