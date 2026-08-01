"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import {
  Crosshair,
  KeyRound,
  Loader2,
  LocateFixed,
  MapPin,
  Maximize2,
  Navigation,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/cn";
import type { StatusFilter } from "@/modules/entity-views/list-experience-toolbar";

type MapItem =
  | {
      type: "cluster";
      id: string;
      lat: number;
      lng: number;
      count: number;
      sampleName?: string;
    }
  | {
      type: "point";
      id: string;
      customerId: string;
      lat: number;
      lng: number;
      name: string;
      tradeName?: string | null;
      brand?: string;
      code: string;
      address?: string | null;
      city?: string | null;
      postalCode?: string | null;
      phone?: string | null;
      status?: string;
      count: number;
      distanceKm?: number;
    };

type SelectedPoint = Extract<MapItem, { type: "point" }>;

type MapBounds = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

type OverlayHandle = {
  id: string;
  kind: "point" | "cluster";
  marker: google.maps.marker.AdvancedMarkerElement;
};

function brandOf(it: Extract<MapItem, { type: "point" }>) {
  return (it.brand || it.tradeName || it.name || it.code || "Πελάτης").trim();
}

function buildPointContent(it: Extract<MapItem, { type: "point" }>) {
  const root = document.createElement("div");
  root.className = "gmap-pin";
  root.innerHTML = `
    <div class="gmap-pin__label">${escapeHtml(brandOf(it))}</div>
    <div class="gmap-pin__stem">
      <span class="gmap-pin__dot"></span>
    </div>
  `;
  return root;
}

function buildClusterContent(count: number, sample?: string) {
  const root = document.createElement("div");
  root.className = "gmap-cluster";
  const size =
    count >= 100 ? "lg" : count >= 25 ? "md" : "sm";
  root.dataset.size = size;
  root.innerHTML = `
    <div class="gmap-cluster__bubble">${count}</div>
    ${
      sample
        ? `<div class="gmap-cluster__hint">${escapeHtml(sample)}</div>`
        : ""
    }
  `;
  return root;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function CustomerMapView({
  q,
  status,
  mapsApiKey,
  mapId = "DEMO_MAP_ID",
}: {
  q: string;
  status: StatusFilter;
  mapsApiKey?: string;
  mapId?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const overlaysRef = useRef<Map<string, OverlayHandle>>(new Map());
  const userMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(
    null,
  );
  const AdvancedMarkerRef = useRef<
    typeof google.maps.marker.AdvancedMarkerElement | null
  >(null);
  const didFitRef = useRef(false);
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const itemsRef = useRef<MapItem[]>([]);

  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{
    ms: number;
    returned: number;
    totalGeocoded: number;
    bounds: MapBounds | null;
  } | null>(null);
  const [nearMe, setNearMe] = useState(false);
  const [radiusKm, setRadiusKm] = useState(25);
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [selected, setSelected] = useState<SelectedPoint | null>(null);
  const [mapQ, setMapQ] = useState(q);
  const queryRef = useRef({ q: mapQ, status, nearMe, radiusKm, userPos });
  queryRef.current = { q: mapQ, status, nearMe, radiusKm, userPos };

  useEffect(() => {
    setMapQ(q);
  }, [q]);

  const apiKey = mapsApiKey?.trim() || "";

  const clearOverlays = useCallback(() => {
    for (const h of overlaysRef.current.values()) {
      h.marker.map = null;
    }
    overlaysRef.current.clear();
  }, []);

  const fitToBounds = useCallback((bounds: MapBounds | null | undefined) => {
    const map = mapRef.current;
    if (!map || !bounds) return;
    const { minLat, maxLat, minLng, maxLng } = bounds;
    if (![minLat, maxLat, minLng, maxLng].every((n) => Number.isFinite(n))) {
      return;
    }
    const pad = 0.03;
    map.fitBounds(
      {
        south: minLat - pad,
        west: minLng - pad,
        north: maxLat + pad,
        east: maxLng + pad,
      },
      64,
    );
  }, []);

  const syncOverlays = useCallback(
    (items: MapItem[]) => {
      const map = mapRef.current;
      const AdvancedMarkerElement = AdvancedMarkerRef.current;
      if (!map || !AdvancedMarkerElement) return;

      itemsRef.current = items;
      const nextIds = new Set(items.map((i) => i.id));

      for (const [id, handle] of overlaysRef.current) {
        if (!nextIds.has(id)) {
          handle.marker.map = null;
          overlaysRef.current.delete(id);
        }
      }

      for (const it of items) {
        const existing = overlaysRef.current.get(it.id);
        if (existing) {
          existing.marker.position = { lat: it.lat, lng: it.lng };
          existing.marker.content =
            it.type === "point"
              ? buildPointContent(it)
              : buildClusterContent(it.count, it.sampleName);
          continue;
        }

        const content =
          it.type === "point"
            ? buildPointContent(it)
            : buildClusterContent(it.count, it.sampleName);

        const marker = new AdvancedMarkerElement({
          map,
          position: { lat: it.lat, lng: it.lng },
          content,
          title:
            it.type === "point"
              ? brandOf(it)
              : `${it.count} πελάτες · ${it.sampleName || ""}`,
          gmpClickable: true,
          zIndex: it.type === "cluster" ? 10 + it.count : 20,
        });

        marker.addListener("click", () => {
          if (it.type === "cluster") {
            map.panTo({ lat: it.lat, lng: it.lng });
            map.setZoom(Math.min((map.getZoom() ?? 8) + 2.2, 16));
            return;
          }
          setSelected(it);
          map.panTo({ lat: it.lat, lng: it.lng });
        });

        overlaysRef.current.set(it.id, {
          id: it.id,
          kind: it.type,
          marker,
        });
      }
    },
    [],
  );

  const fetchFeatures = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    if (!b) return;
    const { q: qq, status: st, nearMe: near, radiusKm: rKm, userPos: pos } =
      queryRef.current;
    const ne = b.getNorthEast();
    const sw = b.getSouthWest();
    const zoom = map.getZoom() ?? 8;
    const params = new URLSearchParams({
      minLat: String(sw.lat()),
      maxLat: String(ne.lat()),
      minLng: String(sw.lng()),
      maxLng: String(ne.lng()),
      zoom: String(Math.round(zoom * 10) / 10),
      backfill: "1",
    });
    if (qq.trim()) params.set("q", qq.trim());
    if (st === "ACTIVE" || st === "INACTIVE") params.set("status", st);
    if (near && pos) {
      params.set("nearLat", String(pos.lat));
      params.set("nearLng", String(pos.lng));
      params.set("radiusKm", String(rKm));
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/customers/map?${params}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Αποτυχία χάρτη");
      const items = (data.items || []) as MapItem[];
      const bounds = (data.meta?.bounds ?? null) as MapBounds | null;
      syncOverlays(items);
      setMeta({
        ms: data.meta?.ms ?? 0,
        returned: data.meta?.returned ?? items.length,
        totalGeocoded: data.meta?.totalGeocoded ?? 0,
        bounds,
      });
      if (!didFitRef.current && bounds && (data.meta?.totalGeocoded ?? 0) > 0) {
        didFitRef.current = true;
        fitToBounds(bounds);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Σφάλμα χάρτη");
    } finally {
      setLoading(false);
    }
  }, [fitToBounds, syncOverlays]);

  const scheduleFetch = useCallback(() => {
    if (fetchTimer.current) clearTimeout(fetchTimer.current);
    fetchTimer.current = setTimeout(() => void fetchFeatures(), 140);
  }, [fetchFeatures]);

  useEffect(() => {
    if (!apiKey) {
      setBootError(
        "Ορίσε NEXT_PUBLIC_GOOGLE_MAPS_API_KEY για Google Maps (Maps JavaScript API + Geocoding).",
      );
      return;
    }
    if (!containerRef.current || mapRef.current) return;

    let cancelled = false;
    setOptions({
      key: apiKey,
      v: "weekly",
      libraries: ["marker"],
      mapIds: mapId ? [mapId] : undefined,
    });

    void (async () => {
      try {
        const [{ Map }, { AdvancedMarkerElement }] = await Promise.all([
          importLibrary("maps"),
          importLibrary("marker"),
        ]);
        if (cancelled || !containerRef.current) return;

        AdvancedMarkerRef.current = AdvancedMarkerElement;
        const map = new Map(containerRef.current, {
          center: { lat: 37.9838, lng: 23.7275 },
          zoom: 6.4,
          mapId,
          disableDefaultUI: true,
          zoomControl: true,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          clickableIcons: false,
          gestureHandling: "greedy",
        });
        mapRef.current = map;

        map.addListener("idle", () => {
          if (fetchTimer.current) clearTimeout(fetchTimer.current);
          fetchTimer.current = setTimeout(() => void fetchFeatures(), 120);
        });
        map.addListener("click", () => setSelected(null));

        setReady(true);
        setBootError(null);
        void fetchFeatures();
      } catch (e) {
        setBootError(
          e instanceof Error
            ? e.message
            : "Αποτυχία φόρτωσης Google Maps",
        );
      }
    })();

    return () => {
      cancelled = true;
      if (fetchTimer.current) clearTimeout(fetchTimer.current);
      clearOverlays();
      userMarkerRef.current && (userMarkerRef.current.map = null);
      userMarkerRef.current = null;
      mapRef.current = null;
      setReady(false);
      didFitRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, mapId]);

  useEffect(() => {
    if (ready) scheduleFetch();
  }, [mapQ, status, nearMe, radiusKm, userPos, ready, scheduleFetch]);

  function locateMe() {
    if (!navigator.geolocation) {
      setError("Η γεωτοποθεσία δεν υποστηρίζεται στον browser");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setUserPos({ lat, lng });
        setNearMe(true);
        const map = mapRef.current;
        const AdvancedMarkerElement = AdvancedMarkerRef.current;
        if (!map || !AdvancedMarkerElement) return;
        map.panTo({ lat, lng });
        map.setZoom(Math.max(map.getZoom() ?? 11, 12));
        userMarkerRef.current && (userMarkerRef.current.map = null);
        const el = document.createElement("div");
        el.className = "gmap-user";
        el.title = "Η θέση σου";
        userMarkerRef.current = new AdvancedMarkerElement({
          map,
          position: { lat, lng },
          content: el,
          zIndex: 1000,
        });
      },
      () => setError("Δεν δόθηκε άδεια τοποθεσίας"),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  const emptyViewport =
    meta != null && meta.returned === 0 && meta.totalGeocoded > 0;

  const pointCount = useMemo(
    () => itemsRef.current.filter((i) => i.type === "point").length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [meta?.returned, meta?.ms],
  );

  return (
    <div className="cmap overflow-hidden rounded-[1.75rem] border border-teal-900/10 bg-white shadow-sm shadow-slate-900/5">
      <style jsx global>{`
        .cmap {
          --cmap-ink: #0b1f33;
          --cmap-accent: #0f766e;
        }
        .gmap-pin {
          display: flex;
          flex-direction: column;
          align-items: center;
          transform: translateY(-4px);
          cursor: pointer;
          filter: drop-shadow(0 8px 16px rgba(15, 23, 42, 0.18));
        }
        .gmap-pin__label {
          max-width: 160px;
          padding: 5px 10px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.96);
          border: 1px solid rgba(15, 118, 110, 0.22);
          color: var(--cmap-ink);
          font: 650 11px/1.2 ui-sans-serif, system-ui, sans-serif;
          letter-spacing: 0.01em;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-bottom: 4px;
        }
        .gmap-pin__stem {
          width: 18px;
          height: 18px;
          border-radius: 999px;
          background: linear-gradient(180deg, #14b8a6, #0f766e);
          border: 2px solid #fff;
          display: grid;
          place-items: center;
        }
        .gmap-pin__dot {
          width: 5px;
          height: 5px;
          border-radius: 999px;
          background: #fff;
        }
        .gmap-cluster {
          display: flex;
          flex-direction: column;
          align-items: center;
          cursor: pointer;
          filter: drop-shadow(0 10px 18px rgba(15, 23, 42, 0.2));
        }
        .gmap-cluster__bubble {
          min-width: 36px;
          height: 36px;
          padding: 0 10px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          color: #fff;
          font: 700 12px/1 ui-sans-serif, system-ui, sans-serif;
          background: radial-gradient(circle at 30% 25%, #2dd4bf, #0f766e 55%, #115e59);
          border: 3px solid #fff;
        }
        .gmap-cluster[data-size="md"] .gmap-cluster__bubble {
          min-width: 44px;
          height: 44px;
          font-size: 13px;
          background: radial-gradient(circle at 30% 25%, #38bdf8, #0e7490 55%, #155e75);
        }
        .gmap-cluster[data-size="lg"] .gmap-cluster__bubble {
          min-width: 52px;
          height: 52px;
          font-size: 14px;
          background: radial-gradient(circle at 30% 25%, #fb7185, #be123c 55%, #9f1239);
        }
        .gmap-cluster__hint {
          margin-top: 4px;
          max-width: 120px;
          padding: 2px 8px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.92);
          font: 600 10px/1.2 ui-sans-serif, system-ui, sans-serif;
          color: #334155;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .gmap-user {
          width: 14px;
          height: 14px;
          border-radius: 999px;
          background: #0ea5e9;
          border: 3px solid #fff;
          box-shadow: 0 0 0 6px rgba(14, 165, 233, 0.25);
        }
      `}</style>

      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 bg-[linear-gradient(180deg,#eef8f6_0%,#ffffff_70%)] px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-teal-700 text-white shadow-sm">
              <MapPin size={16} />
            </span>
            <div>
              <p className="text-sm font-semibold text-[var(--cmap-ink)]">
                Χάρτης πελατών
              </p>
              <p className="text-[11px] text-slate-500">
                Google Maps · pins με επωνυμία · διεύθυνση Branch
              </p>
            </div>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <label className="relative hidden sm:block">
            <Search
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={mapQ}
              onChange={(e) => setMapQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") scheduleFetch();
              }}
              placeholder="Επωνυμία / πόλη / διεύθυνση"
              className="h-8 w-48 rounded-lg border border-slate-200 bg-white pl-8 pr-2 text-xs outline-none ring-teal-600/20 focus:ring-2"
            />
          </label>
          <select
            className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs"
            value={radiusKm}
            onChange={(e) => setRadiusKm(Number(e.target.value))}
            disabled={!nearMe}
            title="Ακτίνα near-me"
          >
            <option value={10}>10 km</option>
            <option value={25}>25 km</option>
            <option value={50}>50 km</option>
            <option value={100}>100 km</option>
          </select>
          <Button
            size="sm"
            variant={nearMe ? "primary" : "secondary"}
            onClick={() => {
              if (nearMe) {
                setNearMe(false);
                scheduleFetch();
              } else {
                locateMe();
              }
            }}
          >
            <LocateFixed size={14} />
            {nearMe ? "Κοντά μου" : "Κοντά μου"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              didFitRef.current = true;
              fitToBounds(meta?.bounds);
              scheduleFetch();
            }}
            disabled={!meta?.bounds}
          >
            <Maximize2 size={14} />
            Όλοι
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void fetchFeatures()}
            disabled={loading || !ready}
          >
            {loading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
          </Button>
        </div>
      </div>

      <div className="relative">
        <div
          ref={containerRef}
          className="h-[min(72vh,760px)] w-full bg-[#e8eef2]"
        />

        {!apiKey || bootError ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[radial-gradient(circle_at_20%_20%,rgba(15,118,110,0.12),transparent_45%),linear-gradient(180deg,#f8fafc,#eef2f7)] p-6">
            <div className="max-w-md rounded-2xl border border-slate-200 bg-white/95 p-5 shadow-xl">
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
                <KeyRound size={18} />
              </div>
              <h3 className="text-base font-semibold text-ink-950">
                Απαιτείται Google Maps API key
              </h3>
              <p className="mt-2 text-sm text-slate-600">
                {bootError ||
                  "Πρόσθεσε το key στο περιβάλλον για pins με επωνυμία πάνω σε Google Maps."}
              </p>
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-slate-500">
                <li>Google Cloud → Maps JavaScript API + Geocoding API</li>
                <li>
                  <code className="rounded bg-slate-100 px-1">
                    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=...
                  </code>
                </li>
                <li>Προαιρετικά Map ID:{" "}
                  <code className="rounded bg-slate-100 px-1">
                    NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID
                  </code>
                </li>
              </ol>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="pointer-events-none absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-xl bg-white/95 px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow">
            <Loader2 size={12} className="animate-spin text-teal-700" />{" "}
            Ενημέρωση…
          </div>
        ) : null}

        {emptyViewport ? (
          <div className="absolute left-1/2 top-3 z-10 w-[min(100%-1.5rem,380px)] -translate-x-1/2 rounded-2xl border border-amber-200 bg-amber-50/95 px-3 py-2 text-center text-xs text-amber-950 shadow">
            Κενή περιοχή ·{" "}
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => {
                didFitRef.current = true;
                fitToBounds(meta?.bounds);
              }}
            >
              Εμφάνιση όλων ({meta?.totalGeocoded})
            </button>
          </div>
        ) : null}

        {meta ? (
          <div className="absolute bottom-3 left-3 z-10 flex flex-wrap gap-1.5">
            <Badge tone="teal">
              {meta.returned.toLocaleString("el-GR")} στο viewport
            </Badge>
            <Badge tone="slate">
              {meta.totalGeocoded.toLocaleString("el-GR")} geocoded
            </Badge>
            <Badge tone="slate">{meta.ms} ms</Badge>
            {pointCount > 0 ? (
              <Badge tone="emerald">{pointCount} επωνυμίες</Badge>
            ) : null}
          </div>
        ) : null}

        {selected ? (
          <aside className="absolute right-3 top-3 z-10 w-[min(100%-1.5rem,300px)] overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-2xl shadow-slate-900/15 backdrop-blur">
            <div className="bg-[linear-gradient(135deg,#0f766e,#115e59)] px-3 py-2.5 text-white">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {brandOf(selected)}
                  </p>
                  <p className="text-[11px] text-teal-100">{selected.code}</p>
                </div>
                <button
                  type="button"
                  className="rounded-lg p-1 text-white/80 hover:bg-white/10 hover:text-white"
                  onClick={() => setSelected(null)}
                  aria-label="Κλείσιμο"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            <div className="space-y-2 px-3 py-3 text-xs text-slate-600">
              <p>
                {[selected.address, selected.postalCode, selected.city]
                  .filter(Boolean)
                  .join(", ") || "Χωρίς διεύθυνση κειμένου"}
              </p>
              {selected.phone ? <p>☎ {selected.phone}</p> : null}
              {selected.distanceKm != null ? (
                <p className="inline-flex items-center gap-1 font-medium text-teal-800">
                  <Crosshair size={12} />
                  {selected.distanceKm} km από εσένα
                </p>
              ) : null}
              <div className="flex gap-2 pt-1">
                <Link
                  href={`/customers/${selected.customerId}`}
                  className="inline-flex h-8 flex-1 items-center justify-center rounded-lg bg-[var(--cmap-ink)] text-xs font-medium text-white hover:bg-slate-900"
                >
                  Άνοιγμα
                </Link>
                <button
                  type="button"
                  className={cn(
                    "inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-medium hover:bg-slate-50",
                  )}
                  onClick={() => {
                    mapRef.current?.panTo({
                      lat: selected.lat,
                      lng: selected.lng,
                    });
                    mapRef.current?.setZoom(16);
                  }}
                >
                  <Navigation size={12} />
                  Zoom
                </button>
              </div>
            </div>
          </aside>
        ) : null}
      </div>

      {error ? (
        <p className="border-t border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
        Zoom out → clusters · Zoom in → pins με επωνυμία. Οι συντεταγμένες
        προκύπτουν από διεύθυνση Branch (Google Geocoding όταν υπάρχει key).
      </p>
    </div>
  );
}
