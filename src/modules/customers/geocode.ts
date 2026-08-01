import {
  approxCoordsFromCity,
  isPlausibleGreeceCoord,
  lookupCityCoords,
} from "@/modules/customers/geo";

export type AddressParts = {
  address?: string | null;
  address2?: string | null;
  city?: string | null;
  postalCode?: string | null;
  region?: string | null;
  country?: string | null;
};

export type GeocodeResult = {
  lat: number;
  lng: number;
  source: "google" | "nominatim" | "postal" | "city" | "fallback";
  query: string;
};

function googleMapsServerKey() {
  return (
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ||
    ""
  );
}

const countryLabel: Record<string, string> = {
  GR: "Greece",
  CY: "Cyprus",
  BG: "Bulgaria",
  RO: "Romania",
  DE: "Germany",
  IT: "Italy",
  FR: "France",
  GB: "United Kingdom",
  US: "United States",
};

/** Stable query string used to detect address changes */
export function buildGeocodeQuery(parts: AddressParts): string {
  const country = (parts.country || "GR").toUpperCase();
  return [
    parts.address?.trim(),
    parts.address2?.trim(),
    parts.postalCode?.trim(),
    parts.city?.trim(),
    parts.region?.trim(),
    country,
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * Geocode a customer/branch address.
 * Prefers OpenStreetMap Nominatim (street-level), then postal/city centroids.
 */
export async function geocodeAddress(
  parts: AddressParts,
  opts?: { allowNominatim?: boolean },
): Promise<GeocodeResult | null> {
  const query = buildGeocodeQuery(parts);
  if (!query.trim()) return null;

  const allowNominatim = opts?.allowNominatim !== false;
  const hasStreet = Boolean(parts.address?.trim());

  const gKey = googleMapsServerKey();
  if (gKey && (hasStreet || parts.city || parts.postalCode)) {
    const g = await googleGeocode(query, gKey, parts.country || "GR");
    if (g && isPlausibleForCountry(g.lat, g.lng, parts.country || "GR")) {
      return { ...g, source: "google", query };
    }
  }

  if (allowNominatim && hasStreet) {
    const nom = await nominatimSearch(query, parts.country || "GR");
    if (nom && isPlausibleForCountry(nom.lat, nom.lng, parts.country || "GR")) {
      return { ...nom, source: "nominatim", query };
    }
    // Retry with street + city only (sometimes full query is too strict)
    const shortQ = [parts.address, parts.postalCode, parts.city, countryLabel[(parts.country || "GR").toUpperCase()] || parts.country]
      .filter(Boolean)
      .join(", ");
    if (shortQ !== query) {
      const nom2 = await nominatimSearch(shortQ, parts.country || "GR");
      if (
        nom2 &&
        isPlausibleForCountry(nom2.lat, nom2.lng, parts.country || "GR")
      ) {
        return { ...nom2, source: "nominatim", query };
      }
    }
  }

  const postal = approxFromGreekPostal(parts.postalCode, parts.city);
  if (postal) {
    return { ...postal, source: "postal", query };
  }

  const city = approxCoordsFromCity(parts.city || parts.region || parts.address);
  if (city) {
    const known = lookupCityCoords(parts.city || parts.region || null);
    return {
      ...city,
      source: known ? "city" : "fallback",
      query,
    };
  }

  return null;
}

function isPlausibleForCountry(lat: number, lng: number, country: string) {
  const c = country.toUpperCase();
  if (c === "GR" || c === "CY") return isPlausibleGreeceCoord(lat, lng) || (lat >= 34.5 && lat <= 35.8 && lng >= 32 && lng <= 34.8);
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/** Rough Greek TK → region centroid (first 2–3 digits) */
function approxFromGreekPostal(
  postalCode: string | null | undefined,
  city: string | null | undefined,
): { lat: number; lng: number } | null {
  const digits = (postalCode || "").replace(/\D/g, "");
  if (digits.length < 2) return null;

  // Prefer city centroid if known — postal only as helper offset
  const cityHit = lookupCityCoords(city);
  const prefix = digits.slice(0, 3);
  const region = GREEK_POSTAL_PREFIX[prefix] || GREEK_POSTAL_PREFIX[digits.slice(0, 2)];
  if (!region && !cityHit) return null;

  const base = cityHit || region!;
  // Use last digits as tiny offset so different TK in same city separate slightly
  const n = Number(digits.slice(-2)) || 0;
  return {
    lat: base.lat + ((n % 10) - 5) * 0.002,
    lng: base.lng + ((Math.floor(n / 10) % 10) - 5) * 0.002,
  };
}

const GREEK_POSTAL_PREFIX: Record<string, { lat: number; lng: number }> = {
  // Athens metro
  "10": { lat: 37.9838, lng: 23.7275 },
  "11": { lat: 37.9838, lng: 23.7275 },
  "12": { lat: 37.96, lng: 23.7 },
  "13": { lat: 38.02, lng: 23.75 },
  "14": { lat: 38.05, lng: 23.8 },
  "15": { lat: 38.04, lng: 23.8 },
  "16": { lat: 37.95, lng: 23.75 },
  "17": { lat: 37.94, lng: 23.7 },
  "18": { lat: 37.94, lng: 23.65 }, // Piraeus area
  "19": { lat: 37.9, lng: 23.75 },
  // Thessaloniki
  "54": { lat: 40.64, lng: 22.94 },
  "55": { lat: 40.62, lng: 22.97 },
  "56": { lat: 40.67, lng: 22.9 },
  "57": { lat: 40.55, lng: 22.95 },
  // Patra / others
  "26": { lat: 38.25, lng: 21.73 },
  "28": { lat: 38.25, lng: 21.73 },
  "71": { lat: 35.34, lng: 25.14 }, // Heraklion
  "73": { lat: 35.51, lng: 24.02 }, // Chania
  "85": { lat: 36.43, lng: 28.22 }, // Rhodes
  "49": { lat: 39.62, lng: 19.92 }, // Corfu
  "38": { lat: 39.37, lng: 22.95 }, // Volos
  "41": { lat: 39.64, lng: 22.42 }, // Larisa
  "45": { lat: 39.67, lng: 20.85 }, // Ioannina
  "65": { lat: 40.94, lng: 24.41 }, // Kavala
  "69": { lat: 40.85, lng: 25.87 }, // Alexandroupoli
};

async function googleGeocode(
  q: string,
  apiKey: string,
  country: string,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", q);
    url.searchParams.set("key", apiKey);
    const cc = country.toUpperCase();
    if (cc.length === 2) {
      url.searchParams.set("components", `country:${cc}`);
      url.searchParams.set("region", cc.toLowerCase());
    }
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      status: string;
      results?: Array<{ geometry?: { location?: { lat: number; lng: number } } }>;
    };
    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") return null;
    const loc = data.results?.[0]?.geometry?.location;
    if (!loc) return null;
    const lat = Number(loc.lat);
    const lng = Number(loc.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

async function nominatimSearch(
  q: string,
  country: string,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1");
    url.searchParams.set("q", q);
    const cc = country.toLowerCase();
    if (cc.length === 2) url.searchParams.set("countrycodes", cc);

    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": "SoftifyOS/1.0 (customer-map-geocoder)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(3500),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    const hit = data[0];
    if (!hit) return null;
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

export async function resolveCustomerGeo(
  parts: AddressParts,
  previous?: { geocodeQuery?: string | null; lat?: number | null; lng?: number | null },
  opts?: { allowNominatim?: boolean },
): Promise<{
  lat: number | null;
  lng: number | null;
  geocodedAt: Date | null;
  geocodeQuery: string | null;
} | null> {
  const query = buildGeocodeQuery(parts);
  if (!query) {
    return { lat: null, lng: null, geocodedAt: null, geocodeQuery: null };
  }

  // Skip if address unchanged and we already have coords
  if (
    previous?.geocodeQuery === query &&
    previous.lat != null &&
    previous.lng != null &&
    isPlausibleForCountry(previous.lat, previous.lng, parts.country || "GR")
  ) {
    return null; // no change
  }

  const result = await geocodeAddress(parts, opts);
  if (!result) {
    return { lat: null, lng: null, geocodedAt: null, geocodeQuery: query };
  }
  return {
    lat: result.lat,
    lng: result.lng,
    geocodedAt: new Date(),
    geocodeQuery: result.query,
  };
}
