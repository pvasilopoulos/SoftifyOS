"use client";

import { createContext, useContext } from "react";
import type { NavGroup, NavItem } from "@/platform/navigation";

type NavContextValue = {
  groups: NavGroup[];
  mobileTabs: NavItem[];
};

const NavContext = createContext<NavContextValue | null>(null);

export function NavProvider({
  groups,
  mobileTabs,
  children,
}: NavContextValue & { children: React.ReactNode }) {
  return (
    <NavContext.Provider value={{ groups, mobileTabs }}>
      {children}
    </NavContext.Provider>
  );
}

export function useNav() {
  const ctx = useContext(NavContext);
  if (!ctx) {
    throw new Error("useNav must be used within NavProvider");
  }
  return ctx;
}
