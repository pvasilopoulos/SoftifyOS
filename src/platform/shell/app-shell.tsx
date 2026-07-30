"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Sidebar } from "@/platform/shell/sidebar";
import { Topbar } from "@/platform/shell/topbar";
import { MobileTabBar } from "@/platform/shell/mobile-tab-bar";
import { CommandPalette } from "@/platform/shell/command-palette";
import { QuickActionsSheet } from "@/platform/shell/quick-actions-sheet";
import { NavProvider } from "@/platform/navigation/nav-context";
import {
  menuTreeToNavGroups,
  type MenuNodeConfig,
  type NavItem,
} from "@/platform/navigation";
import { Settings } from "lucide-react";
import type { SessionPayload } from "@/platform/auth/session";

export function AppShell({
  session,
  menuTree,
  children,
}: {
  session: SessionPayload;
  menuTree: MenuNodeConfig[];
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [, startTransition] = useTransition();

  const groups = useMemo(
    () => menuTreeToNavGroups(menuTree, session.role),
    [menuTree, session.role],
  );

  const mobileTabs = useMemo<NavItem[]>(
    () => [
      ...groups.flatMap((g) => g.items).filter((i) => i.mobileTab),
      {
        id: "more",
        href: "/more",
        label: "Περισσότερα",
        icon: Settings,
        mobileTab: true,
      },
    ],
    [groups],
  );

  useEffect(() => {
    function openCommand() {
      startTransition(() => setCommandOpen(true));
    }
    document.addEventListener("softify:open-command", openCommand);
    return () =>
      document.removeEventListener("softify:open-command", openCommand);
  }, []);

  return (
    <NavProvider groups={groups} mobileTabs={mobileTabs}>
      <div className="flex min-h-dvh bg-[#F1F4F7] text-ink-900">
        <Sidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed((v) => !v)}
          groups={groups}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            session={session}
            onOpenCommand={() => startTransition(() => setCommandOpen(true))}
            onOpenQuickActions={() => startTransition(() => setQuickOpen(true))}
          />
          <main className="flex-1 px-3 pb-24 pt-4 sm:px-5 sm:pt-6 lg:pb-8">
            <div className="mx-auto w-full max-w-7xl animate-fade-in">
              {children}
            </div>
          </main>
        </div>
        <MobileTabBar />
        <CommandPalette
          open={commandOpen}
          onClose={() => setCommandOpen(false)}
        />
        <QuickActionsSheet
          open={quickOpen}
          onClose={() => setQuickOpen(false)}
        />
      </div>
    </NavProvider>
  );
}
