"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Density = "comfortable" | "compact";

const DensityContext = createContext<{
  density: Density;
  setDensity: (d: Density) => void;
}>({
  density: "comfortable",
  setDensity: () => {},
});

const KEY = "softifyos.density";

export function DensityProvider({ children }: { children: ReactNode }) {
  const [density, setDensityState] = useState<Density>("comfortable");

  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v === "compact" || v === "comfortable") setDensityState(v);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  function setDensity(d: Density) {
    setDensityState(d);
    try {
      localStorage.setItem(KEY, d);
    } catch {
      /* ignore */
    }
  }

  return (
    <DensityContext.Provider value={{ density, setDensity }}>
      {children}
    </DensityContext.Provider>
  );
}

export function useDensity() {
  return useContext(DensityContext);
}
