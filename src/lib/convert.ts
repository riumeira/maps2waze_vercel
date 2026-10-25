// Server-only conversion pipeline (Google redirects, FTID/Embed, Places API, Nominatim).
// Shared by the local Express server (server.ts) and the Vercel function (api/convert.ts).
// Relative imports use ".js" so they also resolve as plain ESM on Vercel.
import {
  ConvertResult,
  createCache,
  describeCoords,
  extractCoordinates,
  extractFtid,
  extractPlaceName,
  fetchWithTimeout,
  resolveQuery,
  wazeLink,
} from "./geo.js";

const NOMINATIM_HEADERS = { "User-Agent": "Maps2WazeConverter/1.0 (free-app)" };
const GEO_OPTS = { headers: NOMINATIM_HEADERS };

const GOOGLE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  "Accept-Language": "pt-PT,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  "Cookie": "CONSENT=YES+1; SOCS=CAISHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzEaAmVuIAEaBgiA_LipBg",
};

// Same link → same answer: avoids re-fetching Google and Nominatim (which rate-limits to ~1 req/s)
const conversionCache = createCache<ConvertResult>(500, 24 * 60 * 60 * 1000);

// Convert FTID (hex1:hex2) into Google Place ID (ChIJ...)
function ftidToPlaceId(ftid: string): string | null {
  try {
    const [h1, h2] = ftid.split(":");
    if (!h1 || !h2) return null;
    const buf = Buffer.alloc(17);
    buf.writeBigUInt64LE(BigInt(h1), 0);
    buf[8] = 0x11;
    buf.writeBigUInt64LE(BigInt(h2), 9);
    return "ChIJ" + buf.toString("base64url");
  } catch {
    return null;
  }
}

// Resolve location details directly from Google Maps Embed using FTID
async function resolveFtidViaEmbed(ftid: string) {
  try {
    const pb = "!1m18!1m12!1m3!1d1000!2d0!3d0!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s" + ftid + "!2sLocation!5e0!3m2!1spt-PT!2spt";
    const res = await fetchWithTimeout("https://www.google.com/maps/embed?pb=" + pb, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "pt-PT,pt;q=0.9",
      },
    });
    if (!res.ok) return null;
    const html = await res.text();

    const details = html.match(/\["0x[0-9a-f]+:0x[0-9a-f]+","([^"]+)",\[(-?\d+\.\d+),(-?\d+\.\d+)\]/i);
    if (details) {
      const fullAddress = details[1];
      return {
        lat: parseFloat(details[2]),
        lng: parseFloat(details[3]),
        title: fullAddress.split(",")[0].trim() || fullAddress,
        fullAddress,
      };
    }

    const coords = html.match(/\[(-?\d+\.\d{4,}),\s*(-?\d+\.\d{4,})\]/);
    if (coords) {
      return { lat: parseFloat(coords[1]), lng: parseFloat(coords[2]), title: "", fullAddress: "" };
    }
  } catch (err) {
    console.error("Embed resolution error:", err);
  }
  return null;
}

async function resolveViaPlacesApi(placeId: string): Promise<ConvertResult | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetchWithTimeout(
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${apiKey}&language=pt`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const loc = data.result?.geometry?.location;
    if (data.status !== "OK" || !loc) return null;
    const title = data.result.name || data.result.formatted_address;
    return {
      lat: loc.lat,
      lng: loc.lng,
      title,
      fullAddress: data.result.formatted_address || title,
      wazeUrl: wazeLink(loc.lat, loc.lng),
    };
  } catch (err) {
    console.error("Google Places API call error:", err);
    return null;
  }
}

/** Follows redirects of a (short) Google Maps link. Only downloads the page HTML when the URL alone isn't enough. */
async function expandUrl(url: string): Promise<{ finalUrl: string; html: string }> {
  let finalUrl = url;
  let html = "";

  // Step A: automatic redirect following
  try {
    const res = await fetchWithTimeout(url, { redirect: "follow", headers: GOOGLE_HEADERS });
    finalUrl = res.url || url;
    if (extractCoordinates(finalUrl)) {
      await res.body?.cancel();
    } else {
      html = await res.text();
    }
    if (finalUrl !== url || extractCoordinates(html)) return { finalUrl, html };
  } catch (err) {
    console.warn("Follow redirect failed, falling back to manual hop loop:", err);
  }

  // Step B: manual hop loop (meta refresh, canonical links, consent pages)
  let currentUrl = url;
  for (let hops = 0; hops < 10; hops++) {
    try {
      const res = await fetchWithTimeout(currentUrl, { redirect: "manual", headers: GOOGLE_HEADERS });
      let nextUrl = res.headers.get("location");

      if (nextUrl) {
        await res.body?.cancel();
        if (nextUrl.startsWith("/")) nextUrl = new URL(currentUrl).origin + nextUrl;
        if (nextUrl.includes("consent.google.com") || nextUrl.includes("accounts.google.com")) {
          try {
            nextUrl = new URL(nextUrl).searchParams.get("continue") || nextUrl;
          } catch {
            // Keep nextUrl as is
          }
        }
      } else {
        html = await res.text();
        if (extractCoordinates(html)) break;
        nextUrl =
          html.match(/content=["']\d+;\s*url=([^"'>]+)["']/i)?.[1] ||
          html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i)?.[1] ||
          html.match(/href=["'](https?:\/\/(?:www\.)?google\.[a-z.]+\/maps\/[^"']+)["']/i)?.[1] ||
          html.match(/(https:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|www\.google\.com\/maps)[^\s"'>]+)/i)?.[1] ||
          null;
        if (!nextUrl || nextUrl === currentUrl) break;
        nextUrl = nextUrl.replace(/&amp;/g, "&");
      }

      currentUrl = finalUrl = nextUrl;
      if (extractCoordinates(currentUrl)) break;
    } catch (err) {
      console.error("Error following redirect at hop", hops, err);
      break;
    }
  }
  return { finalUrl, html };
}

export async function convert(input: string): Promise<ConvertResult | null> {
  let url = input;
  let isHttpUrl = /^https?:\/\//i.test(url);
  if (!isHttpUrl && /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/.*)?$/i.test(url)) {
    url = "https://" + url;
    isHttpUrl = true;
  }

  // Plain text address rather than a link
  if (!isHttpUrl) {
    const coords = extractCoordinates(url);
    if (coords) return { ...(await describeCoords(coords, null, GEO_OPTS)), method: "direct" };
    return { ...(await resolveQuery(url, GEO_OPTS)), method: "nominatim_free" };
  }

  const { finalUrl, html } = extractCoordinates(url) ? { finalUrl: url, html: "" } : await expandUrl(url);
  const coords = extractCoordinates(finalUrl) || (html ? extractCoordinates(html) : null);
  const placeName = extractPlaceName(finalUrl, html);

  // 1. FTID → Google Embed gives the exact pinned location
  const ftid = extractFtid(finalUrl, url, html);
  if (ftid) {
    const embed = await resolveFtidViaEmbed(ftid);
    if (embed?.lat && embed.lng) {
      const result = await describeCoords(embed, embed.title || placeName, GEO_OPTS);
      return { ...result, fullAddress: embed.fullAddress || result.fullAddress, finalUrl, method: "google_embed" };
    }

    // 2. Optional Google Places API (only when GOOGLE_MAPS_API_KEY is set)
    const placeId = ftidToPlaceId(ftid);
    const place = placeId ? await resolveViaPlacesApi(placeId) : null;
    if (place) return { ...place, finalUrl, method: "google_places_api" };
  }

  // 3. Coordinates found directly in the URL or HTML
  if (coords) return { ...(await describeCoords(coords, placeName, GEO_OPTS)), finalUrl, method: "direct" };

  // 4. Free geocoding of the place name, falling back to a Waze search-by-address link
  if (placeName) {
    const result = await resolveQuery(placeName, GEO_OPTS);
    return { ...result, finalUrl, method: result.isAddressOnly ? "address_query_fallback" : "nominatim_free" };
  }
  return null;
}

/** Validates the request body, uses the cache and returns the HTTP status + JSON body to send. */
export async function handleConvertRequest(body: unknown): Promise<{ status: number; body: ConvertResult | { error: string } }> {
  const raw = (body as { url?: unknown } | null)?.url;
  const input = typeof raw === "string" ? raw.trim() : "";
  if (!input) {
    return { status: 400, body: { error: "A ligação é obrigatória." } };
  }

  try {
    const cached = conversionCache.get(input);
    if (cached) return { status: 200, body: cached };

    const result = await convert(input);
    if (!result) {
      return {
        status: 400,
        body: {
          error: "Não foi possível extrair as coordenadas nem a morada deste link. Por favor, verifique o link ou introduza a morada diretamente.",
        },
      };
    }
    if (!result.isAddressOnly) conversionCache.set(input, result);
    return { status: 200, body: result };
  } catch (error) {
    console.error("Error expanding URL:", error);
    return { status: 500, body: { error: "Falha ao processar a ligação. Pode estar inacessível ou ser inválida." } };
  }
}
