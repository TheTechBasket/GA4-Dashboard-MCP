/**
 * countriesCache.ts
 * Fetches and caches country metadata from restcountries.com.
 * Provides helpers for country coordinates, names, and capitals.
 * Cache TTL: 7 days (data changes rarely).
 */

import fs from "fs";
import path from "path";
import https from "https";

// ── Types ──────────────────────────────────────────────────────────────────

export interface CountryInfo {
  /** ISO 3166-1 alpha-2 code (e.g. "US") */
  cca2: string;
  /** Common name (e.g. "United States") */
  name: string;
  /** Geographic centroid [lat, lng] */
  latlng: [number, number] | null;
  /** Capital city name (first capital listed) */
  capital: string | null;
  /** Capital city lat/lng */
  capitalLatlng: [number, number] | null;
  /** Top-level domain(s) */
  tld: string[];
  /** FIFA country code */
  fifa: string | null;
}

interface CacheFile {
  fetchedAt: string;
  countries: CountryInfo[];
}

// ── Config ────────────────────────────────────────────────────────────────

const CACHE_DIR  = path.join(__dirname, "../.cache");
const CACHE_PATH = path.join(CACHE_DIR, "countries.json");
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const RESTCOUNTRIES_URL =
  "https://restcountries.com/v3.1/all?fields=cca2,name,latlng,capital,capitalInfo,tld,fifa";

// ── In-memory store ────────────────────────────────────────────────────────

let countryMap: Map<string, CountryInfo> | null = null; // keyed by lowercase cca2

// ── HTTP helper (no extra deps) ───────────────────────────────────────────

function fetchJSON(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(new Error("JSON parse error: " + String(e)));
          }
        });
      })
      .on("error", reject);
  });
}

// ── Cache helpers ──────────────────────────────────────────────────────────

function readCache(): CacheFile | null {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;
    const raw = fs.readFileSync(CACHE_PATH, "utf-8");
    return JSON.parse(raw) as CacheFile;
  } catch {
    return null;
  }
}

function writeCache(countries: CountryInfo[]): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const data: CacheFile = { fetchedAt: new Date().toISOString(), countries };
    fs.writeFileSync(CACHE_PATH, JSON.stringify(data), "utf-8");
  } catch (err) {
    console.warn("[countriesCache] Failed to write cache:", String(err));
  }
}

function isCacheStale(cache: CacheFile): boolean {
  const age = Date.now() - new Date(cache.fetchedAt).getTime();
  return age > CACHE_TTL_MS;
}

// ── Data transform ────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function transform(raw: any[]): CountryInfo[] {
  return raw
    .filter((r) => r.cca2 && r.name?.common)
    .map((r) => {
      const latlng: [number, number] | null =
        Array.isArray(r.latlng) && r.latlng.length === 2
          ? [r.latlng[0], r.latlng[1]]
          : null;

      const capitalLatlng: [number, number] | null =
        r.capitalInfo?.latlng && Array.isArray(r.capitalInfo.latlng)
          ? [r.capitalInfo.latlng[0], r.capitalInfo.latlng[1]]
          : null;

      return {
        cca2: (r.cca2 as string).toUpperCase(),
        name: r.name.common as string,
        latlng,
        capital: Array.isArray(r.capital) ? (r.capital[0] as string) ?? null : null,
        capitalLatlng,
        tld: Array.isArray(r.tld) ? (r.tld as string[]) : [],
        fifa: r.fifa ? (r.fifa as string) : null,
      };
    });
}

// ── Main loader ────────────────────────────────────────────────────────────

async function loadCountries(): Promise<Map<string, CountryInfo>> {
  // 1. Use in-memory if already loaded
  if (countryMap) return countryMap;

  // 2. Try disk cache
  const cache = readCache();
  if (cache && !isCacheStale(cache)) {
    countryMap = new Map(cache.countries.map((c) => [c.cca2.toUpperCase(), c]));
    return countryMap;
  }

  // 3. Fetch from restcountries.com
  try {
    console.log("[countriesCache] Fetching from restcountries.com…");
    const raw = (await fetchJSON(RESTCOUNTRIES_URL)) as unknown[];
    const countries = transform(raw as never[]);
    writeCache(countries);
    countryMap = new Map(countries.map((c) => [c.cca2.toUpperCase(), c]));
    console.log(`[countriesCache] Loaded ${countryMap.size} countries`);
    return countryMap;
  } catch (err) {
    console.warn("[countriesCache] Fetch failed, using stale/empty cache:", String(err));
    // Fall back to stale cache if available
    if (cache) {
      countryMap = new Map(cache.countries.map((c) => [c.cca2.toUpperCase(), c]));
      return countryMap;
    }
    return new Map();
  }
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Get full country info by ISO2 code.
 * @example await getCountry("IN") // → { name: "India", latlng: [20, 77], ... }
 */
export async function getCountry(cca2: string): Promise<CountryInfo | undefined> {
  const map = await loadCountries();
  return map.get(cca2.toUpperCase());
}

/**
 * Get [lat, lng] for a country's geographic centroid.
 * Falls back to capital coordinates if centroid is missing.
 */
export async function getCountryLatLng(cca2: string): Promise<[number, number] | null> {
  const c = await getCountry(cca2);
  if (!c) return null;
  return c.latlng ?? c.capitalLatlng ?? null;
}

/**
 * Get capital city [lat, lng] by country ISO2 code.
 * Useful as a fallback coordinate when city-level lookup fails.
 */
export async function getCapitalLatLng(cca2: string): Promise<[number, number] | null> {
  const c = await getCountry(cca2);
  return c?.capitalLatlng ?? c?.latlng ?? null;
}

/**
 * Get common country name by ISO2 code.
 * @example await getCountryName("DE") // → "Germany"
 */
export async function getCountryName(cca2: string): Promise<string> {
  const c = await getCountry(cca2);
  return c?.name ?? cca2;
}

/**
 * Warm the cache on startup without blocking.
 * Call this once at app startup so initial API requests don't need to wait.
 */
export function warmCountriesCache(): void {
  loadCountries().catch((err) =>
    console.warn("[countriesCache] Warm failed:", String(err))
  );
}

/**
 * Returns all loaded countries sorted by name.
 */
export async function getAllCountries(): Promise<CountryInfo[]> {
  const map = await loadCountries();
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}
