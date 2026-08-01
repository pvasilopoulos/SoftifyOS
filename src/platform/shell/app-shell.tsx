"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Sidebar, readSidebarCollapsed } from "@/platform/shell/sidebar";
import { Topbar } from "@/platform/shell/topbar";
import { MobileTabBar } from "@/platform/shell/mobile-tab-bar";
import { CommandPalette } from "@/platform/shell/command-palette";
import { QuickActionsSheet } from "@/platform/shell/quick-actions-sheet";
import { NavProvider } from "@/platform/navigation/nav-context";
import { AppToaster } from "@/shared/ui/toaster";
import { DensityProvider } from "@/shared/ui/density";
import {
  menuTreeToNavGroups,
  type MenuAudience,
  type MenuNodeConfig,
} from "@/platform/navigation";
import {
  resolveMobileTabsForAudience,
  type MobileFooterOverrides,
} from "@/platform/navigation/menu-tree";
import type { SessionPayload } from "@/platform/auth/session";

export function AppShell({
  session,
  menuTree,
  menuAudience,
  navGroupsDefaultExpanded = true,
  mobileFooterOverrides,
  maintenanceMode = false,
  children,
}: {
  session: SessionPayload;
  menuTree: MenuNodeConfig[];
  menuAudience?: MenuAudience;
  navGroupsDefaultExpanded?: boolean;
  mobileFooterOverrides?: MobileFooterOverrides | null;
  maintenanceMode?: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    setCollapsed(readSidebarCollapsed());
  }, []);

  const audience = useMemo<MenuAudience>(
    () =>
      menuAudience ?? {
        role: session.role,
        userId: session.sub,
        groupIds: [],
      },
    [menuAudience, session.role, session.sub],
  );

  const groups = useMemo(
    () => menuTreeToNavGroups(menuTree, audience, navGroupsDefaultExpanded),
    [menuTree, audience, navGroupsDefaultExpanded],
  );

  const mobileTabs = useMemo(
    () =>
      resolveMobileTabsForAudience(groups, audience, mobileFooterOverrides),
    [groups, audience, mobileFooterOverrides],
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
    <DensityProvider>
      <NavProvider groups={groups} mobileTabs={mobileTabs}>
        <div className="flex min-h-dvh bg-[#F1F4F7] text-ink-900 data-[density=compact]:[&_.soft-panel]:p-3">
          <Sidebar
            collapsed={collapsed}
            onToggle={() => setCollapsed((v) => !v)}
            groups={groups}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            {maintenanceMode &&
            session.role !== "OWNER" &&
            session.role !== "ADMIN" ? (
              <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
                Το σύστημα βρίσκεται σε κατάσταση συντήρησης. Ορισμένες ενέργειες
                μπορεί να είναι περιορισμένες.
              </div>
            ) : null}
            <Topbar
              session={session}
              onOpenCommand={() => startTransition(() => setCommandOpen(true))}
              onOpenQuickActions={() =>
                startTransition(() => setQuickOpen(true))
              }
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
          <AppToaster />
        </div>
      </NavProvider>
    </DensityProvider>
  );
}
