/** Approximate city centroids (Greece) for demo / fallback geocoding */
export const GREECE_CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  αθηνα: { lat: 37.9838, lng: 23.7275 },
  athens: { lat: 37.9838, lng: 23.7275 },
  πειραιας: { lat: 37.942, lng: 23.646 },
  piraeus: { lat: 37.942, lng: 23.646 },
  θεσσαλονικη: { lat: 40.6401, lng: 22.9444 },
  thessaloniki: { lat: 40.6401, lng: 22.9444 },
  πατρα: { lat: 38.2466, lng: 21.7346 },
  ηρακλειο: { lat: 35.3387, lng: 25.1442 },
  λαρισα: { lat: 39.639, lng: 22.4191 },
  βολος: { lat: 39.3666, lng: 22.9507 },
  ιωαννινα: { lat: 39.665, lng: 20.8537 },
  καβαλα: { lat: 40.9396, lng: 24.4069 },
  ροδος: { lat: 36.4349, lng: 28.2176 },
  χανια: { lat: 35.5138, lng: 24.018 },
  κερκυρα: { lat: 39.6243, lng: 19.9217 },
  αλεξανδρουπολη: { lat: 40.8457, lng: 25.8744 },
  καλαματα: { lat: 37.0389, lng: 22.1142 },
  τρικαλα: { lat: 39.5553, lng: 21.7679 },
  σερρες: { lat: 41.0909, lng: 23.5413 },
  λαμια: { lat: 38.9, lng: 22.4333 },
  κομοτηνη: { lat: 41.122, lng: 25.405 },
  μυτιληνη: { lat: 39.104, lng: 26.555 },
  χαλκιδα: { lat: 38.463, lng: 23.599 },
  αγρινιο: { lat: 38.621, lng: 21.409 },
  κατερινη: { lat: 40.269, lng: 22.504 },
  ξεανθη: { lat: 41.135, lng: 24.888 },
  ξανθη: { lat: 41.135, lng: 24.888 },
  δραμα: { lat: 41.151, lng: 24.146 },
  βεροια: { lat: 40.523, lng: 22.202 },
  κοζανη: { lat: 40.301, lng: 21.789 },
  γλυφαδα: { lat: 37.862, lng: 23.755 },
  μαρουσι: { lat: 38.05, lng: 23.805 },
  περιστερι: { lat: 38.015, lng: 23.691 },
  καλανδρι: { lat: 38.026, lng: 23.8 },
  νικαια: { lat: 37.967, lng: 23.647 },
  κερατσινι: { lat: 37.962, lng: 23.62 },
};

export function normalizeCityKey(city: string) {
  return city
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    // unify sigma forms so dictionary keys match typed Greek
    .replace(/ς/g, "σ");
}

/** Pre-normalized city → coords (σ-only keys) */
const CITY_INDEX: Record<string, { lat: number; lng: number }> = Object.fromEntries(
  Object.entries(GREECE_CITY_COORDS).map(([k, v]) => [normalizeCityKey(k), v]),
);

export function lookupCityCoords(city: string | null | undefined): {
  lat: number;
  lng: number;
  matched: boolean;
} | null {
  if (!city?.trim()) return null;
  const key = normalizeCityKey(city);
  const exact = CITY_INDEX[key];
  if (exact) return { ...exact, matched: true };

  // Partial: "Έδρα Πειραιά", "Δήμος Αθηναίων", etc.
  for (const [name, coords] of Object.entries(CITY_INDEX)) {
    if (name.length < 4) continue;
    const stem = name.replace(/σ$/, "");
    if (
      key.includes(name) ||
      key.includes(stem) ||
      (key.length >= 4 && (name.includes(key) || stem.includes(key)))
    ) {
      return { ...coords, matched: true };
    }
  }
  return null;
}

export function approxCoordsFromCity(city: string | null | undefined): {
  lat: number;
  lng: number;
} | null {
  if (!city?.trim()) return null;
  const hit = lookupCityCoords(city);
  if (hit) {
    const h = hashStr(normalizeCityKey(city) + city);
    // small jitter (~±150m) so pins in same city don't stack perfectly
    return {
      lat: hit.lat + ((h % 100) - 50) * 0.00003,
      lng: hit.lng + (((h >> 8) % 100) - 50) * 0.00003,
    };
  }
  // Greece fallback scatter around mainland (always inside country bbox)
  const h = hashStr(normalizeCityKey(city));
  return {
    lat: 36.8 + ((h % 400) / 400) * 3.8,
    lng: 20.5 + (((h >> 11) % 400) / 400) * 7.5,
  };
}

/** True when point is roughly inside Greece / nearby Aegean */
export function isPlausibleGreeceCoord(lat: number, lng: number) {
  return lat >= 34.5 && lat <= 41.9 && lng >= 19.2 && lng <= 29.8;
}

function hashStr(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Grid cell size in degrees for server-side clustering */
export function cellSizeForZoom(zoom: number) {
  // Show individual named pins earlier so brand labels are usable
  if (zoom >= 11) return 0;
  if (zoom >= 9.5) return 0.015;
  if (zoom >= 8) return 0.04;
  if (zoom >= 6.5) return 0.1;
  if (zoom >= 5) return 0.25;
  if (zoom >= 3.5) return 0.6;
  return 1.2;
}

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function bboxFromCenter(
  lat: number,
  lng: number,
  radiusKm: number,
): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180) || 1);
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}
