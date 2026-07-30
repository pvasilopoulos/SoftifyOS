"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { mobileTabs } from "@/platform/navigation";
import { cn } from "@/shared/lib/cn";

export function MobileTabBar() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/90 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <ul className="grid grid-cols-4">
        {mobileTabs.slice(0, 4).map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "flex flex-col items-center gap-1 px-1 py-2.5 text-[11px]",
                  active ? "text-teal-700" : "text-slate-500",
                )}
              >
                <Icon size={20} strokeWidth={active ? 2.25 : 1.75} />
                <span className="truncate font-medium">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
