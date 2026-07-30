"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "@/platform/shell/sidebar";
import { Topbar } from "@/platform/shell/topbar";
import { MobileTabBar } from "@/platform/shell/mobile-tab-bar";
import { CommandPalette } from "@/platform/shell/command-palette";
import { QuickActionsSheet } from "@/platform/shell/quick-actions-sheet";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);

  useEffect(() => {
    function openCommand() {
      setCommandOpen(true);
    }
    document.addEventListener("softify:open-command", openCommand);
    return () =>
      document.removeEventListener("softify:open-command", openCommand);
  }, []);

  return (
    <div className="flex min-h-dvh bg-[#F1F4F7] text-ink-900">
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((v) => !v)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          onOpenCommand={() => setCommandOpen(true)}
          onOpenQuickActions={() => setQuickOpen(true)}
        />
        <main className="flex-1 px-3 pb-24 pt-4 sm:px-5 sm:pt-6 lg:pb-8">
          <div className="mx-auto w-full max-w-7xl animate-fade-in">
            {children}
          </div>
        </main>
      </div>
      <MobileTabBar />
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} />
      <QuickActionsSheet open={quickOpen} onClose={() => setQuickOpen(false)} />
    </div>
  );
}
