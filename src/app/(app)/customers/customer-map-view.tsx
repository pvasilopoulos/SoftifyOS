"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import maplibregl, { type Map, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  Crosshair,
  Loader2,
  LocateFixed,
  MapPin,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
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
      code: string;
      address?: string | null;
      city?: string | null;
      status?: string;
      count: number;
      distanceKm?: number;
    };

type SelectedPoint = Extract<MapItem, { type: "point" }>;

export function CustomerMapView({
  q,
  status,
}: {
  q: string;
  status: StatusFilter;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{
    ms: number;
    returned: number;
    totalGeocoded: number;
  } | null>(null);
  const [nearMe, setNearMe] = useState(false);
  const [radiusKm, setRadiusKm] = useState(25);
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [selected, setSelected] = useState<SelectedPoint | null>(null);
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryRef = useRef({ q, status, nearMe, radiusKm, userPos });
  queryRef.current = { q, status, nearMe, radiusKm, userPos };

  const fetchFeatures = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    const { q: qq, status: st, nearMe: near, radiusKm: rKm, userPos: pos } =
      queryRef.current;
    const b = map.getBounds();
    const zoom = map.getZoom();
    const params = new URLSearchParams({
      minLat: String(b.getSouth()),
      maxLat: String(b.getNorth()),
      minLng: String(b.getWest()),
      maxLng: String(b.getEast()),
      zoom: String(Math.round(zoom * 10) / 10),
      backfill: "1",
    });
    if (qq.trim()) params.set("q", qq.trim());
    if (st === "ACTIVE" || st === "INACTIVE") {
      params.set("status", st);
    }
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
      const geojson: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: items.map((it) => ({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [it.lng, it.lat],
          },
          properties: {
            id: it.id,
            type: it.type,
            count: it.count,
            customerId: it.type === "point" ? it.customerId : null,
            name: it.type === "point" ? it.name : (it.sampleName ?? ""),
            code: it.type === "point" ? it.code : "",
            address: it.type === "point" ? (it.address ?? "") : "",
            city: it.type === "point" ? (it.city ?? "") : "",
            status: it.type === "point" ? (it.status ?? "") : "",
            distanceKm: it.type === "point" ? (it.distanceKm ?? null) : null,
          },
        })),
      };

      const src = map.getSource("customers") as GeoJSONSource | undefined;
      if (src) src.setData(geojson);
      setMeta({
        ms: data.meta?.ms ?? 0,
        returned: data.meta?.returned ?? items.length,
        totalGeocoded: data.meta?.totalGeocoded ?? 0,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Σφάλμα χάρτη");
    } finally {
      setLoading(false);
    }
  }, []);

  const scheduleFetch = useCallback(() => {
    if (fetchTimer.current) clearTimeout(fetchTimer.current);
    fetchTimer.current = setTimeout(() => void fetchFeatures(), 180);
  }, [fetchFeatures]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap",
            maxzoom: 19,
          },
        },
        layers: [
          {
            id: "osm",
            type: "raster",
            source: "osm",
          },
        ],
      },
      center: [23.7275, 37.9838],
      zoom: 6.2,
      attributionControl: { compact: true },
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      map.addSource("customers", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "customers",
        filter: ["==", ["get", "type"], "cluster"],
        paint: {
          "circle-color": [
            "step",
            ["get", "count"],
            "#0f766e",
            25,
            "#0e7490",
            100,
            "#b45309",
            500,
            "#be123c",
          ],
          "circle-radius": [
            "step",
            ["get", "count"],
            18,
            25,
            22,
            100,
            28,
            500,
            34,
          ],
          "circle-opacity": 0.88,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });

      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "customers",
        filter: ["==", ["get", "type"], "cluster"],
        layout: {
          "text-field": ["to-string", ["get", "count"]],
          "text-size": 12,
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
        },
        paint: { "text-color": "#ffffff" },
      });

      map.addLayer({
        id: "points",
        type: "circle",
        source: "customers",
        filter: ["==", ["get", "type"], "point"],
        paint: {
          "circle-color": "#0f766e",
          "circle-radius": 7,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });

      map.on("click", "clusters", (e) => {
        const f = e.features?.[0];
        if (!f || f.geometry.type !== "Point") return;
        const lng = Number(f.geometry.coordinates[0]);
        const lat = Number(f.geometry.coordinates[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
        map.easeTo({ center: [lng, lat], zoom: Math.min(map.getZoom() + 2.2, 16) });
      });

      map.on("click", "points", (e) => {
        const f = e.features?.[0];
        if (!f?.properties) return;
        const p = f.properties;
        const geom = f.geometry;
        if (geom.type !== "Point") return;
        const lng = Number(geom.coordinates[0]);
        const lat = Number(geom.coordinates[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
        setSelected({
          type: "point",
          id: String(p.id),
          customerId: String(p.customerId),
          lat,
          lng,
          name: String(p.name ?? ""),
          code: String(p.code ?? ""),
          address: String(p.address ?? "") || null,
          city: String(p.city ?? "") || null,
          status: String(p.status ?? ""),
          count: 1,
          distanceKm:
            p.distanceKm == null || p.distanceKm === ""
              ? undefined
              : Number(p.distanceKm),
        });
      });

      map.on("mouseenter", "clusters", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "clusters", () => {
        map.getCanvas().style.cursor = "";
      });
      map.on("mouseenter", "points", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "points", () => {
        map.getCanvas().style.cursor = "";
      });

      map.on("moveend", () => {
        if (fetchTimer.current) clearTimeout(fetchTimer.current);
        fetchTimer.current = setTimeout(() => void fetchFeatures(), 180);
      });
      setReady(true);
      void fetchFeatures();
    });

    return () => {
      if (fetchTimer.current) clearTimeout(fetchTimer.current);
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [fetchFeatures]);

  useEffect(() => {
    if (ready) scheduleFetch();
  }, [q, status, nearMe, radiusKm, userPos, ready, scheduleFetch]);

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
        mapRef.current?.easeTo({
          center: [lng, lat],
          zoom: Math.max(mapRef.current.getZoom(), 11),
        });
        if (mapRef.current) {
          userMarkerRef.current?.remove();
          const el = document.createElement("div");
          el.className =
            "h-3.5 w-3.5 rounded-full bg-sky-500 ring-4 ring-sky-200 shadow";
          userMarkerRef.current = new maplibregl.Marker({ element: el })
            .setLngLat([lng, lat])
            .addTo(mapRef.current);
        }
      },
      () => setError("Δεν δόθηκε άδεια τοποθεσίας"),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <div className="soft-panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2.5">
        <MapPin size={16} className="text-teal-700" />
        <p className="text-sm font-semibold text-ink-950">Χάρτης πελατών</p>
        <span className="text-xs text-slate-500">
          Server clustering · bbox queries (έτοιμο για ~450k)
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            Ακτίνα
            <select
              className="h-8 rounded-lg border border-slate-200 bg-white px-2"
              value={radiusKm}
              onChange={(e) => setRadiusKm(Number(e.target.value))}
              disabled={!nearMe}
            >
              <option value={10}>10 km</option>
              <option value={25}>25 km</option>
              <option value={50}>50 km</option>
              <option value={100}>100 km</option>
            </select>
          </label>
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
            {nearMe ? "Κοντά μου · ON" : "Κοντά μου"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void fetchFeatures()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Ανανέωση
          </Button>
        </div>
      </div>

      <div className="relative">
        <div
          ref={containerRef}
          className="h-[min(70vh,720px)] w-full bg-slate-100"
        />
        {loading ? (
          <div className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-lg bg-white/95 px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow">
            <Loader2 size={12} className="animate-spin" /> Φόρτωση…
          </div>
        ) : null}
        {meta ? (
          <div className="absolute bottom-3 left-3 rounded-lg bg-white/95 px-2.5 py-1.5 text-[11px] text-slate-600 shadow">
            {meta.returned.toLocaleString("el-GR")} σημεία/clusters ·{" "}
            {meta.totalGeocoded.toLocaleString("el-GR")} με συντεταγμένες ·{" "}
            {meta.ms} ms
          </div>
        ) : null}
        {selected ? (
          <div className="absolute right-3 top-3 w-[min(100%-1.5rem,280px)] rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink-950">
                  {selected.name}
                </p>
                <p className="text-xs text-slate-500">{selected.code}</p>
              </div>
              <button
                type="button"
                className="text-slate-400 hover:text-ink-900"
                onClick={() => setSelected(null)}
              >
                ×
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-600">
              {[selected.address, selected.city].filter(Boolean).join(", ") ||
                "Χωρίς διεύθυνση κειμένου"}
            </p>
            {selected.distanceKm != null ? (
              <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-teal-800">
                <Crosshair size={12} />
                {selected.distanceKm} km από εσένα
              </p>
            ) : null}
            <div className="mt-3 flex gap-2">
              <Link
                href={`/customers/${selected.customerId}`}
                className="inline-flex h-8 flex-1 items-center justify-center rounded-lg bg-teal-800 text-xs font-medium text-white hover:bg-teal-900"
              >
                Άνοιγμα
              </Link>
              <button
                type="button"
                className="h-8 rounded-lg border border-slate-200 px-2.5 text-xs"
                onClick={() =>
                  mapRef.current?.easeTo({
                    center: [selected.lng, selected.lat],
                    zoom: 15,
                  })
                }
              >
                Zoom
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="border-t border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">
        Zoom out → clusters · Zoom in → pins. Οι συντεταγμένες αποθηκεύονται στο
        Branch· για 450k χρησιμοποίησε batch geocoding· το map API δεν φορτώνει
        ποτέ όλο το dataset.
      </p>
    </div>
  );
}
