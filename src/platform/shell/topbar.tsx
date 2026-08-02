"use client";

import { useRouter } from "next/navigation";
import { LogOut, Search, Zap } from "lucide-react";
import { Button } from "@/shared/ui/button";
import type { SessionPayload } from "@/platform/auth/session";
import { NotificationsButton } from "@/platform/shell/notifications-panel";
import { ThemeToggle } from "@/shared/ui/theme";
import { TenantSwitcher } from "@/platform/shell/tenant-switcher";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function Topbar({
  session,
  onOpenCommand,
  onOpenQuickActions,
}: {
  session: SessionPayload;
  onOpenCommand: () => void;
  onOpenQuickActions: () => void;
}) {
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-slate-200/80 bg-[#F1F4F7]/90 px-3 backdrop-blur sm:h-16 sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-2 lg:hidden">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-950 text-xs font-bold text-white">
          S
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink-950">SoftifyOS</p>
          <p className="truncate text-[11px] text-slate-500">
            {session.tenantName}
          </p>
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
        <ThemeToggle />
        <NotificationsButton />
        <div className="hidden md:block">
          <TenantSwitcher session={session} />
        </div>
        <div className="md:hidden">
          <TenantSwitcher session={session} compact />
        </div>
        <div
          className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-950 text-xs font-semibold text-white"
          title={session.name}
        >
          {initials(session.name) || "U"}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={logout}
          aria-label="Αποσύνδεση"
          title="Αποσύνδεση"
        >
          <LogOut size={18} />
        </Button>
      </div>
    </header>
  );
}
