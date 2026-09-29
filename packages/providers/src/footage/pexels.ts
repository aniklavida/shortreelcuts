/**
 * A real Pexels footage adapter — the first implementation of
 * `FootageProvider`, and the proof that `docs/SPEC.md` §5.1's
 * provider-neutral seam holds for footage the way it already holds for
 * script and voice: the stage cannot tell Pexels from Pixabay from
 * `pexels.ts` below.
 *
 * Bring-your-own-key only, resolved from the environment by
 * `resolveFootageConnection`. No key ships with this package, and nothing
 * here hardcodes a default provider — a self-hoster picks Pexels or
 * Pixabay in their `.env` and that choice is the configuration
 * (`AGENTS.md`, "Truthfulness": a configured environment variable is the
 * integration, and there is no claim here about a key nobody has set).
 *
 * Two rules shape the whole file:
 *
 * 1. **Candidates carry no media URL.** `search` reads four fields per
 *    result — `id`, `duration`, `user.name`, `url` — and deliberately
 *    discards `video_files`, which is where Pexels puts the actual
 *    `videos.pexels.com` download link. The stage records the asset id;
 *    `resolveMediaUrl` re-asks Pexels for the file at render time. A plan
 *    is exportable and shareable, so a baked-in CDN link would be a
 *    licence-redistribution leak, and it expires besides.
 * 2. **A bad response fails the stage.** A non-2xx throws
 *    `FootageProviderRequestError`; a 2xx that is not the documented
 *    shape throws `FootageProviderParseError`. Neither is coerced into a
 *    synthetic clip, because a plan field either came from a real
 *    decision or the stage fails — never a third option.
 */
import type { FootageProvider, StockClipCandidate, StockSearchRequest } from "../types.js";
import {
  FootageProviderParseError,
  FootageProviderRequestError,
  joinBase,
  responseExcerpt,
  type RemoteStockConnection,
} from "./remoteStock.js";

/** The only host a Pexels URL is allowed to occupy inside a plan: the human-facing asset page. Never `videos.pexels.com`. */
export const PEXELS_PLAN_URL_HOSTS: readonly string[] = ["www.pexels.com", "pexels.com"];

interface PexelsVideoFile {
  readonly id?: number;
  readonly file_type?: string;
  readonly width?: number;
  readonly height?: number;
  readonly link?: string;
}

interface PexelsVideo {
  readonly id?: number | string;
  readonly duration?: number;
  readonly url?: string;
  readonly user?: { readonly name?: string };
  readonly video_files?: readonly PexelsVideoFile[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(response: Response, providerId: string): Promise<{ json: unknown; raw: Uint8Array }> {
  const raw = new Uint8Array(await response.arrayBuffer());
  if (!response.ok) {
    // Thrown before parsing: a 401 body is a provider error, not a shape error,
    // and the URL that led here is not echoed because on some providers it holds the key.
    throw new FootageProviderRequestError(providerId, response.status, response.statusText);
  }
  try {
    return { json: JSON.parse(new TextDecoder().decode(raw)) as unknown, raw };
  } catch (err) {
    throw new FootageProviderParseError(providerId, responseExcerpt(raw), err);
  }
}

/** Normalises one search hit. Reads only the four fields a candidate may hold. */
function toCandidate(hit: PexelsVideo, index: number, request: StockSearchRequest): StockClipCandidate | undefined {
  const assetId = typeof hit.id === "number" ? String(hit.id) : typeof hit.id === "string" ? hit.id : undefined;
  const durationSeconds = typeof hit.duration === "number" && Number.isFinite(hit.duration) ? hit.duration : 0;
  // A hit with no id cannot be re-resolved, so it is not a candidate at all.
  if (!assetId) return undefined;

  const creator = hit.user?.name?.trim() || "a Pexels contributor";
  const pageUrl = typeof hit.url === "string" && hit.url.length > 0 ? hit.url : `https://www.pexels.com/search/videos/${encodeURIComponent(request.search)}/`;
  const label = `${request.search} — Pexels ${assetId}${durationSeconds > 0 ? ` (${durationSeconds}s)` : ""}${index > 0 ? ` #${index + 1}` : ""}`;

  return { assetId, label, durationSeconds, credit: { creator, pageUrl } };
}

/**
 * The smallest MP4 that still carries at least 1080 pixels of width, else
 * the widest available — deterministic, and chosen so a 1080×1920 render
 * never downloads a 4K source for it.
 */
function bestVideoFileUrl(files: readonly PexelsVideoFile[]): string | undefined {
  const mp4s = files
    .filter((file) => file.file_type === "video/mp4" && typeof file.link === "string" && file.link.length > 0)
    .map((file, index) => ({ file, index, width: typeof file.width === "number" ? file.width : 0 }))
    .sort((a, b) => a.width - b.width || a.index - b.index);

  const wideEnough = mp4s.filter((entry) => entry.width >= 1080);
  const chosen = wideEnough[0] ?? mp4s[mp4s.length - 1];
  return chosen?.file.link;
}

export function createPexelsFootageProvider(connection: RemoteStockConnection): FootageProvider {
  const providerId = "pexels";
  return {
    id: providerId,
    planUrlHosts: PEXELS_PLAN_URL_HOSTS,

    async search(request: StockSearchRequest, signal?: AbortSignal): Promise<StockClipCandidate[]> {
      const url = new URL(joinBase(connection.baseURL, "/videos/search"));
      url.searchParams.set("query", request.search);
      url.searchParams.set("per_page", String(request.count));
      url.searchParams.set("orientation", request.orientation);

      const response = await fetch(url, {
        headers: { authorization: connection.apiKey },
        signal: signal ?? null,
      });

      const { json, raw } = await readJson(response, providerId);
      if (!isRecord(json) || !Array.isArray(json["videos"])) {
        throw new FootageProviderParseError(providerId, responseExcerpt(raw), new Error("no `videos` array in the response"));
      }
      return (json["videos"] as PexelsVideo[])
        .map((hit, index) => toCandidate(hit, index, request))
        .filter((candidate): candidate is StockClipCandidate => candidate !== undefined);
    },

    async resolveMediaUrl(assetId: string, signal?: AbortSignal): Promise<string> {
      const url = new URL(joinBase(connection.baseURL, `/videos/videos/${encodeURIComponent(assetId)}`));
      const response = await fetch(url, {
        headers: { authorization: connection.apiKey },
        signal: signal ?? null,
      });

      const { json, raw } = await readJson(response, providerId);
      if (!isRecord(json) || !Array.isArray(json["video_files"])) {
        throw new FootageProviderParseError(
          providerId,
          responseExcerpt(raw),
          new Error("the single-video response carried no `video_files` array"),
        );
      }

      const link = bestVideoFileUrl(json["video_files"] as PexelsVideoFile[]);
      if (!link) {
        throw new FootageProviderParseError(
          providerId,
          responseExcerpt(raw),
          new Error("the single-video response carried no usable MP4 rendition"),
        );
      }
      return link;
    },
  };
}
