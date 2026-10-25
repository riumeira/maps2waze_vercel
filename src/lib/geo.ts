// Shared Google Maps → Waze helpers, used both by server.ts and by the client-side fallback in Converter.tsx.
// Must stay free of Node-only (Buffer, fs) and DOM-only APIs.

export interface Coords {
  lat: number;
  lng: number;
}

export interface AddressInfo {
  title: string;
  fullAddress: string;
  road: string;
  houseNumber: string;
  postcode: string;
  city: string;
}

export interface ConvertResult extends Partial<AddressInfo> {
  title: string;
  wazeUrl: string;
  lat?: number;
  lng?: number;
  finalUrl?: string;
  isAddressOnly?: boolean;
  method?: string;
}

export interface FetchOptions {
  headers?: Record<string, string>;
  lang?: string;
  timeoutMs?: number;
}

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const DEFAULT_TIMEOUT_MS = 8000;
const FOREIGN_RE = /(?:españ|spain|francia|france|italia|italy|germany|alemanha|uk|united kingdom|usa|estados unidos)/i;
const COORD_ONLY_RE = /^-?\d+\.\d+[\s,%]+-?\d+\.\d+$/;

export const wazeLink = (lat: number, lng: number) => `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
export const wazeSearchLink = (query: string) => `https://waze.com/ul?q=${encodeURIComponent(query)}&navigate=yes`;

export function safeDecode(str: string): string {
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

/** fetch() with a timeout so a slow upstream never hangs a conversion. */
export function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const signal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(timeoutMs) : undefined;
  return fetch(url, { ...init, signal });
}

/** Small bounded cache (insertion-ordered Map, oldest evicted first) with optional TTL. */
export function createCache<V>(maxEntries: number, ttlMs = Infinity) {
  const store = new Map<string, { value: V; at: number }>();
  return {
    get(key: string): V | undefined {
      const hit = store.get(key);
      if (!hit) return undefined;
      if (Date.now() - hit.at > ttlMs) {
        store.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key: string, value: V) {
      store.delete(key);
      store.set(key, { value, at: Date.now() });
      if (store.size > maxEntries) store.delete(store.keys().next().value!);
    },
  };
}

// ---------------------------------------------------------------------------
// Coordinate / place extraction
// ---------------------------------------------------------------------------

function toCoords(a: string, b: string, lngFirst = false): Coords | null {
  const lat = parseFloat(lngFirst ? b : a);
  const lng = parseFloat(lngFirst ? a : b);
  if (isNaN(lat) || isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function matchCoords(str: string, re: RegExp, lngFirst = false): Coords | null {
  const m = str.match(re);
  return m ? toCoords(m[1], m[2], lngFirst) : null;
}

// Ordered from most to least precise. The /dir/ check runs between the two groups.
const PRECISE_PATTERNS: [RegExp, boolean][] = [
  // !3d<lat>!4d<lng> — the actual pinned location
  [/!3d(-?\d+\.\d+)[^!]*!4d(-?\d+\.\d+)/i, false],
  // !2d<lng>!3d<lat> — embed / pb strings
  [/!2d(-?\d+\.\d+)[^!]*!3d(-?\d+\.\d+)/i, true],
  // Static map image or meta tags (og:image center=lat,lng / markers=lat,lng)
  [/(?:staticmap\?|center=|markers=|ll=)[^"'>]*(?:center|markers|ll|sll)=?(-?\d+\.\d+)(?:%2C|,)(-?\d+\.\d+)/i, false],
];

const FALLBACK_PATTERNS: [RegExp, boolean][] = [
  // Explicit coordinates in query or path (q=, destination=, place/...)
  [/(?:q=|query=|destination=|ll=|center=|sll=|search\/|place\/)(-?\d+\.\d+)[,%](-?\d+\.\d+)/i, false],
  // Camera position (@lat,lng,17z)
  [/@(-?\d+\.\d+)[,%](-?\d+\.\d+)/i, false],
  // Google Maps JS state arrays: [null,null,lat,lng] / [3,"...",[lat,lng]] / [1,[null,null,lat,lng]]
  [/(?:\[null,null,|\[3,"[^"]*",\[|\[1,\[null,null,)(-?\d+\.\d+),(-?\d+\.\d+)\]/i, false],
];

const ANY_PAIR_RE = /(?:^|[^-\d])(-?\d+\.\d+)[,%](-?\d+\.\d+)(?:$|[^-\d])/;
const DIR_PAIR_RE = /(-?\d+\.\d+)[,%](-?\d+\.\d+)/g;

/** Extracts coordinates from a Google Maps URL or page HTML. */
export function extractCoordinates(input: string): Coords | null {
  if (!input) return null;
  const s = safeDecode(input);

  for (const [re, lngFirst] of PRECISE_PATTERNS) {
    const c = matchCoords(s, re, lngFirst);
    if (c) return c;
  }

  // Directions (/dir/origin/destination): the last valid pair is the destination
  if (s.includes('/dir/')) {
    let last: Coords | null = null;
    for (const m of s.matchAll(DIR_PAIR_RE)) last = toCoords(m[1], m[2]) || last;
    if (last) return last;
  }

  for (const [re, lngFirst] of FALLBACK_PATTERNS) {
    const c = matchCoords(s, re, lngFirst);
    if (c) return c;
  }

  // Any float pair — only for short inputs (URLs or raw "lat,lng"), never whole HTML pages
  return s.length < 500 ? matchCoords(s, ANY_PAIR_RE) : null;
}

/** Google Feature ID (e.g. 0xd1ec...:0x8b8f...) from the first source that contains one. */
export function extractFtid(...sources: (string | undefined)[]): string | null {
  for (const s of sources) {
    const m = s?.match(/0x[0-9a-f]+:0x[0-9a-f]+/i);
    if (m) return m[0];
  }
  return null;
}

function cleanTitle(raw: string | undefined): string | null {
  const clean = raw?.replace(/\s*-\s*Google Maps/i, '').trim();
  return clean && !clean.toLowerCase().includes('google maps') ? clean : null;
}

function cleanQuery(raw: string | undefined): string | null {
  const clean = raw?.replace(/\+/g, ' ').trim();
  return clean && !COORD_ONLY_RE.test(clean) ? clean : null;
}

/** Place / address name from the page title (og:title, <title>) or the URL (/maps/place/…, q=…). */
export function extractPlaceName(url: string, html?: string): string | null {
  if (html) {
    const name =
      cleanTitle(html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i)?.[1]) ||
      cleanTitle(html.match(/<title>([^<]+)<\/title>/i)?.[1]);
    if (name) return name;
  }
  const decoded = safeDecode(url);
  return (
    cleanQuery(decoded.match(/\/maps\/place\/([^/@?]+)/i)?.[1]) ||
    cleanQuery(decoded.match(/(?:q=|query=|search\/)([^&/?]+)/i)?.[1])
  );
}

// ---------------------------------------------------------------------------
// Nominatim (OpenStreetMap) geocoding
// ---------------------------------------------------------------------------

const reverseCache = createCache<AddressInfo | null>(500);

/** Reverse geocodes coordinates into a structured address (cached). */
export async function reverseGeocode(lat: number, lng: number, opts: FetchOptions = {}): Promise<AddressInfo | null> {
  const lang = opts.lang || 'pt';
  const key = `${lat.toFixed(6)},${lng.toFixed(6)},${lang}`;
  const cached = reverseCache.get(key);
  if (cached !== undefined) return cached;

  try {
    const res = await fetchWithTimeout(
      `${NOMINATIM}/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=${lang}`,
      { headers: opts.headers },
      opts.timeoutMs,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const addr = data.address || {};
    const storeName = addr.shop || addr.amenity || addr.building || addr.company || addr.tourism || addr.leisure || addr.office;
    const road = addr.road || addr.pedestrian || addr.footway || addr.path || '';
    const houseNumber = addr.house_number || addr.house_name || '';
    const city = addr.city || addr.town || addr.village || addr.municipality || addr.suburb || addr.county || '';
    const fullAddress: string = data.display_name || '';

    let title = storeName || '';
    if (!title && road) title = `${road}${houseNumber ? `, Nº ${houseNumber}` : ''}${city ? `, ${city}` : ''}`;
    if (!title && fullAddress) title = fullAddress.split(',').slice(0, 2).join(',').trim();

    const info: AddressInfo = { title, fullAddress, road, houseNumber, postcode: addr.postcode || '', city };
    reverseCache.set(key, info);
    return info;
  } catch (err) {
    console.error('Reverse geocoding error:', err);
    return null;
  }
}

function searchCandidates(query: string): string[] {
  const withCountry = (q: string) => (q.toLowerCase().includes('portugal') ? [q] : [q, `${q}, Portugal`]);
  const parts = query.split(',').map((s) => s.trim()).filter(Boolean);
  const candidates = withCountry(query);
  // Drop the POI name (first part), then also the trailing country/region part
  if (parts.length > 1) candidates.push(...withCountry(parts.slice(1).join(', ')));
  if (parts.length > 2) candidates.push(...withCountry(parts.slice(1, -1).join(', ')));
  return [...new Set(candidates)];
}

/** Forward geocodes free text, trying progressively simpler variants (Portugal first). */
export async function geocode(query: string, opts: FetchOptions = {}): Promise<(Coords & { fullAddress: string; name: string }) | null> {
  for (const q of searchCandidates(query)) {
    const base = `${NOMINATIM}/search?q=${encodeURIComponent(q)}&format=json&limit=1`;
    const urls = FOREIGN_RE.test(q) ? [base] : [`${base}&countrycodes=pt`, base];
    for (const url of urls) {
      try {
        const res = await fetchWithTimeout(url, { headers: opts.headers }, opts.timeoutMs);
        if (!res.ok) continue;
        const data = await res.json();
        const hit = Array.isArray(data) ? data[0] : null;
        const coords = hit && toCoords(hit.lat, hit.lon);
        if (coords) {
          const fullAddress: string = hit.display_name || query;
          return { ...coords, fullAddress, name: fullAddress.split(',')[0] };
        }
      } catch (err) {
        console.error('Nominatim geocode failed:', q, err);
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// High-level resolution
// ---------------------------------------------------------------------------

/** Builds a result for known coordinates; a place name from the link wins over the reverse-geocoded title. */
export async function describeCoords(coords: Coords, placeName: string | null, opts: FetchOptions = {}): Promise<ConvertResult> {
  const info = await reverseGeocode(coords.lat, coords.lng, opts);
  return {
    ...info,
    lat: coords.lat,
    lng: coords.lng,
    title: placeName || info?.title || `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`,
    wazeUrl: wazeLink(coords.lat, coords.lng),
  };
}

/** Geocodes an address/place; falls back to a Waze search-by-address link if it can't be found. */
export async function resolveQuery(query: string, opts: FetchOptions = {}): Promise<ConvertResult> {
  const label = query.split(',')[0].trim() || query;
  const hit = await geocode(query, opts);
  if (hit) {
    return { lat: hit.lat, lng: hit.lng, title: label, fullAddress: hit.fullAddress, wazeUrl: wazeLink(hit.lat, hit.lng) };
  }
  return { title: label, fullAddress: query, wazeUrl: wazeSearchLink(query), isAddressOnly: true };
}

/** Resolves a (possibly expanded) Google Maps URL plus its page HTML into a Waze destination. */
export async function resolveFromPage(url: string, html: string, opts: FetchOptions = {}): Promise<ConvertResult | null> {
  const coords = extractCoordinates(url) || (html ? extractCoordinates(html) : null);
  const placeName = extractPlaceName(url, html);
  if (coords) return describeCoords(coords, placeName, opts);
  return placeName ? resolveQuery(placeName, opts) : null;
}
