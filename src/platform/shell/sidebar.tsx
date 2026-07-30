"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeft } from "lucide-react";
import { navGroups } from "@/platform/navigation";
import { cn } from "@/shared/lib/cn";

export function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "hidden h-dvh shrink-0 flex-col border-r border-slate-200/80 bg-white/90 backdrop-blur lg:flex",
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
          onClick={onToggle}
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-ink-900"
          aria-label={collapsed ? "Άνοιγμα μενού" : "Σύμπτυξη μενού"}
        >
          {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-4">
        {navGroups.map((group) => (
          <div key={group.id} className="mb-5">
            {!collapsed ? (
              <p className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                {group.label}
              </p>
            ) : null}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
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
                      {!collapsed ? <span className="truncate">{item.label}</span> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
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
