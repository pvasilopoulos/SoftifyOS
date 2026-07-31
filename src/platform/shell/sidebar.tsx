"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, PanelLeftClose, PanelLeft } from "lucide-react";
import type { NavGroup } from "@/platform/navigation";
import { cn } from "@/shared/lib/cn";

const SIDEBAR_COLLAPSED_KEY = "softify:sidebar-collapsed";
const GROUP_EXPANDED_KEY = "softify:nav-group-expanded";

function readCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function readGroupExpanded(groupIds: string[]): Record<string, boolean> {
  const defaults = Object.fromEntries(groupIds.map((id) => [id, true]));
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(GROUP_EXPANDED_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

function writeGroupExpanded(map: Record<string, boolean>) {
  try {
    window.localStorage.setItem(GROUP_EXPANDED_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function Sidebar({
  collapsed,
  onToggle,
  groups,
}: {
  collapsed: boolean;
  onToggle: () => void;
  groups: NavGroup[];
}) {
  const pathname = usePathname();
  const groupIds = useMemo(() => groups.map((g) => g.id), [groups]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(groupIds.map((id) => [id, true])),
  );

  useEffect(() => {
    setExpanded(readGroupExpanded(groupIds));
  }, [groupIds]);

  function toggleGroup(id: string) {
    setExpanded((prev) => {
      const next = { ...prev, [id]: !(prev[id] ?? true) };
      writeGroupExpanded(next);
      return next;
    });
  }

  function handleSidebarToggle() {
    writeCollapsed(!collapsed);
    onToggle();
  }

  return (
    <aside
      className={cn(
        "hidden h-dvh shrink-0 flex-col border-r border-slate-200/80 bg-white/90 backdrop-blur transition-[width] duration-200 lg:flex",
        collapsed ? "w-[76px]" : "w-[248px]",
      )}
    >
      <div className="flex h-16 items-center justify-between gap-2 border-b border-slate-200/80 px-3">
        <Link href="/" className="flex min-w-0 items-center gap-2.5 px-1">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink-950 text-sm font-bold text-white">
            S
          </span>
          {!collapsed ? (
            <span className="truncate text-[15px] font-semibold tracking-tight text-ink-950">
              SoftifyOS
            </span>
          ) : null}
        </Link>
        <button
          type="button"
          onClick={handleSidebarToggle}
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-ink-900"
          aria-label={collapsed ? "Άνοιγμα μενού" : "Σύμπτυξη μενού"}
          aria-pressed={!collapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-4" aria-label="Κύρια πλοήγηση">
        {groups.map((group) => {
          const isOpen = collapsed ? true : (expanded[group.id] ?? true);
          const hasActive = group.items.some((item) =>
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href),
          );

          return (
            <div key={group.id} className="mb-5">
              {!collapsed ? (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={isOpen}
                  className={cn(
                    "mb-1.5 flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1 text-left transition-colors hover:bg-slate-50",
                    hasActive && !isOpen && "bg-teal-50/60",
                  )}
                >
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                    {group.label}
                  </span>
                  <ChevronDown
                    size={14}
                    className={cn(
                      "shrink-0 text-slate-400 transition-transform duration-200",
                      !isOpen && "-rotate-90",
                    )}
                  />
                </button>
              ) : null}

              {isOpen ? (
                <ul className="space-y-0.5">
                  {group.items.map((item) => {
                    const active =
                      item.href === "/"
                        ? pathname === "/"
                        : pathname.startsWith(item.href);
                    const Icon = item.icon;
                    return (
                      <li key={item.id || item.href}>
                        <Link
                          href={item.href}
                          title={item.label}
                          className={cn(
                            "flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition-colors",
                            active
                              ? "bg-teal-50 font-medium text-teal-900"
                              : "text-slate-600 hover:bg-slate-100 hover:text-ink-900",
                            collapsed && "justify-center px-0",
                          )}
                        >
                          <Icon
                            size={18}
                            className={cn(
                              "shrink-0",
                              active ? "text-teal-700" : "text-slate-400",
                            )}
                          />
                          {!collapsed ? (
                            <span className="truncate">{item.label}</span>
                          ) : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-slate-200/80 p-3">
        <div
          className={cn(
            "rounded-xl bg-slate-50 px-3 py-2.5",
            collapsed && "px-2 text-center",
          )}
        >
          {!collapsed ? (
            <>
              <p className="text-xs font-medium text-ink-900">Template v2</p>
              <p className="text-[11px] text-slate-500">Desktop + Mobile</p>
            </>
          ) : (
            <p className="text-[10px] font-semibold text-teal-700">v2</p>
          )}
        </div>
      </div>
    </aside>
  );
}

export { readCollapsed as readSidebarCollapsed };
