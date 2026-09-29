/**
 * A real Pixabay footage adapter — the second implementation of
 * `FootageProvider`, and the reason the interface exists: the footage
 * stage calls this exactly as it calls `pexels.ts`, and cannot tell them
 * apart.
 *
 * Bring-your-own-key only, resolved from the environment by
 * `resolveFootageConnection`. No key ships with this package and no
 * default provider is chosen for the self-hoster.
 *
 * Two differences from the Pexels adapter, both real rather than stylistic:
 *
 * - **Pixabay authenticates with `key` in the query string**, not a header.
 *   That is why no error thrown from this file ever includes a URL: the URL
 *   *is* the credential. `FootageProviderRequestError` carries a status
 *   code and nothing else.
 * - **Pixabay's terms require the caller to respect a 24-hour response
 *   cache** — the same search must not be re-fetched inside that window.
 *   `createMemoryResponseCache` implements it and the clock is injected,
 *   so `pixabay.test.ts` proves the window without waiting a day. Only the
 *   parsed clip list is cached (ids, labels, durations, credit); no media
 *   URL and no bytes, for the same reason the plan holds none.
 *
 * Like the Pexels adapter, `search` deliberately discards the `videos`
 * rendition object that carries the `cdn.pixabay.com` download link. The
 * stage records the asset id; `resolveMediaUrl` re-asks Pixabay for the
 * file at render time.
 */
import type { FootageProvider, StockClipCandidate, StockSearchRequest } from "../types.js";
import {
  FootageProviderParseError,
  FootageProviderRequestError,
  createMemoryResponseCache,
  joinBase,
  responseExcerpt,
  type RemoteStockConnection,
  type ResponseCache,
} from "./remoteStock.js";

/** The only host a Pixabay URL is allowed to occupy inside a plan: the human-facing asset page. Never `cdn.pixabay.com`. */
export const PIXABAY_PLAN_URL_HOSTS: readonly string[] = ["pixabay.com", "www.pixabay.com"];

/** Pixabay names its renditions; the array is ordered widest-first, which the resolution rule below relies on. */
const RENDITION_ORDER = ["large", "medium", "small", "tiny"] as const;

type Rendition = { readonly url?: string; readonly width?: number; readonly height?: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toCandidate(hit: Record<string, unknown>, index: number, request: StockSearchRequest): StockClipCandidate | undefined {
  const assetId = typeof hit["id"] === "number" ? String(hit["id"]) : typeof hit["id"] === "string" ? hit["id"] : undefined;
  // A hit with no id cannot be re-resolved, so it is not a candidate at all.
  if (!assetId) return undefined;

  const durationSeconds = typeof hit["duration"] === "number" && Number.isFinite(hit["duration"]) ? hit["duration"] : 0;
  const creator = typeof hit["user"] === "string" && hit["user"].trim().length > 0 ? hit["user"].trim() : "a Pixabay contributor";
  const pageUrl =
    typeof hit["pageURL"] === "string" && hit["pageURL"].length > 0
      ? hit["pageURL"]
      : `https://pixabay.com/videos/search/${encodeURIComponent(request.search)}/`;
  const label = `${request.search} — Pixabay ${assetId}${durationSeconds > 0 ? ` (${durationSeconds}s)` : ""}${index > 0 ? ` #${index + 1}` : ""}`;

  return { assetId, label, durationSeconds, credit: { creator, pageUrl } };
}

/**
 * The smallest rendition that still carries at least 1080 pixels of width,
 * else the widest — the same rule the Pexels adapter applies, so a plan
 * behaves identically whichever library answered.
 */
function bestRenditionUrl(videos: unknown): string | undefined {
  if (!isRecord(videos)) return undefined;
  const renditions = RENDITION_ORDER.map((name) => videos[name]).filter(isRecord) as Rendition[];
  const usable = renditions
    .map((rendition, index) => ({ rendition, index, width: typeof rendition.width === "number" ? rendition.width : 0 }))
    .filter((entry) => typeof entry.rendition.url === "string" && entry.rendition.url.length > 0)
    .sort((a, b) => a.width - b.width || a.index - b.index);
  const wideEnough = usable.filter((entry) => entry.width >= 1080);
  return (wideEnough[0] ?? usable[usable.length - 1])?.rendition.url;
}

export function createPixabayFootageProvider(
  connection: RemoteStockConnection,
  options: { readonly cache?: ResponseCache; readonly now?: () => number } = {},
): FootageProvider {
  const providerId = "pixabay";
  const cache = options.cache ?? createMemoryResponseCache(options.now);

  const fetchHits = async (url: URL, signal?: AbortSignal): Promise<Record<string, unknown>[]> => {
    const response = await fetch(url, { signal: signal ?? null });
    if (!response.ok) {
      // Before parsing, and never quoting the URL: on Pixabay the key is in it.
      throw new FootageProviderRequestError(providerId, response.status, response.statusText);
    }
    const raw = new Uint8Array(await response.arrayBuffer());
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(raw)) as unknown;
    } catch (err) {
      throw new FootageProviderParseError(providerId, responseExcerpt(raw), err);
    }
    if (!isRecord(json) || !Array.isArray(json["hits"])) {
      throw new FootageProviderParseError(providerId, responseExcerpt(raw), new Error("no `hits` array in the response"));
    }
    return (json["hits"] as unknown[]).filter(isRecord);
  };

  return {
    id: providerId,
    planUrlHosts: PIXABAY_PLAN_URL_HOSTS,

    async search(request: StockSearchRequest, signal?: AbortSignal): Promise<StockClipCandidate[]> {
      // The cache key is the request as issued, so two beats with the same
      // search term hit the network once and one library search is served
      // from it for the next 24 hours.
      const url = new URL(joinBase(connection.baseURL, "/videos/"));
      url.searchParams.set("key", connection.apiKey);
      url.searchParams.set("q", request.search);
      url.searchParams.set("per_page", String(request.count));
      url.searchParams.set("safesearch", "true");

      const cacheKey = `${request.search}|${request.count}`;
      const cached = cache.get(cacheKey) as readonly StockClipCandidate[] | undefined;
      if (cached) return [...cached];

      const hits = await fetchHits(url, signal);
      const candidates = hits
        .map((hit, index) => toCandidate(hit, index, request))
        .filter((candidate): candidate is StockClipCandidate => candidate !== undefined);

      cache.set(cacheKey, candidates);
      return [...candidates];
    },

    async resolveMediaUrl(assetId: string, signal?: AbortSignal): Promise<string> {
      const url = new URL(joinBase(connection.baseURL, "/videos/"));
      url.searchParams.set("key", connection.apiKey);
      url.searchParams.set("id", assetId);

      const hits = await fetchHits(url, signal);
      const link = hits[0] ? bestRenditionUrl(hits[0]["videos"]) : undefined;
      if (!link) {
        throw new FootageProviderParseError(
          providerId,
          `no usable rendition for asset ${assetId}`,
          new Error("the single-video response carried no rendition with a URL"),
        );
      }
      return link;
    },
  };
}
