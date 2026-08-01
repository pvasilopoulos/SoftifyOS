/** Approximate city centroids (Greece) for demo / fallback geocoding */
export const GREECE_CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  αθήνα: { lat: 37.9838, lng: 23.7275 },
  αθηνα: { lat: 37.9838, lng: 23.7275 },
  athens: { lat: 37.9838, lng: 23.7275 },
  θεσσαλονίκη: { lat: 40.6401, lng: 22.9444 },
  θεσσαλονικη: { lat: 40.6401, lng: 22.9444 },
  πάτρα: { lat: 38.2466, lng: 21.7346 },
  πατρα: { lat: 38.2466, lng: 21.7346 },
  ηράκλειο: { lat: 35.3387, lng: 25.1442 },
  ηρακλειο: { lat: 35.3387, lng: 25.1442 },
  λάρισα: { lat: 39.639, lng: 22.4191 },
  λαρισα: { lat: 39.639, lng: 22.4191 },
  βόλος: { lat: 39.3666, lng: 22.9507 },
  βολος: { lat: 39.3666, lng: 22.9507 },
  ιωάννινα: { lat: 39.665, lng: 20.8537 },
  ιωαννινα: { lat: 39.665, lng: 20.8537 },
  καβάλα: { lat: 40.9396, lng: 24.4069 },
  καβαλα: { lat: 40.9396, lng: 24.4069 },
  ρόδος: { lat: 36.4349, lng: 28.2176 },
  ροδος: { lat: 36.4349, lng: 28.2176 },
  χανιά: { lat: 35.5138, lng: 24.018 },
  χανια: { lat: 35.5138, lng: 24.018 },
  κέρκυρα: { lat: 39.6243, lng: 19.9217 },
  κερκυρα: { lat: 39.6243, lng: 19.9217 },
  αλεξανδρούπολη: { lat: 40.8457, lng: 25.8744 },
  αλεξανδρουπολη: { lat: 40.8457, lng: 25.8744 },
  καλαμάτα: { lat: 37.0389, lng: 22.1142 },
  καλαματα: { lat: 37.0389, lng: 22.1142 },
  τρίκαλα: { lat: 39.5553, lng: 21.7679 },
  τρικαλα: { lat: 39.5553, lng: 21.7679 },
  σειρές: { lat: 41.0909, lng: 23.5413 },
  σερρες: { lat: 41.0909, lng: 23.5413 },
};

export function normalizeCityKey(city: string) {
  return city
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

export function approxCoordsFromCity(city: string | null | undefined): {
  lat: number;
  lng: number;
} | null {
  if (!city?.trim()) return null;
  const key = normalizeCityKey(city);
  const hit = GREECE_CITY_COORDS[key];
  if (hit) {
    // slight jitter so pins don't stack exactly
    const h = hashStr(key + city);
    return {
      lat: hit.lat + ((h % 100) - 50) * 0.0015,
      lng: hit.lng + (((h >> 8) % 100) - 50) * 0.0015,
    };
  }
  // Greece fallback scatter around mainland
  const h = hashStr(key);
  return {
    lat: 37.5 + ((h % 300) / 100) * 2.5,
    lng: 21.5 + (((h >> 9) % 400) / 100) * 3.5,
  };
}

function hashStr(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Grid cell size in degrees for server-side clustering */
export function cellSizeForZoom(zoom: number) {
  if (zoom >= 15) return 0;
  if (zoom >= 13) return 0.01;
  if (zoom >= 11) return 0.03;
  if (zoom >= 9) return 0.08;
  if (zoom >= 7) return 0.2;
  if (zoom >= 5) return 0.5;
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
