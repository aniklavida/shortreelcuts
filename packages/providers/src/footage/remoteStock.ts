/**
 * What the two real stock-footage adapters (Pexels, Pixabay) share:
 * their errors, the guard that keeps a media URL out of a plan, the
 * response cache Pixabay's terms require, and the base-URL handling.
 *
 * The one rule this file exists to enforce is the licence-redistribution
 * rule from `AGENTS.md` ("Secrets"): **a plan document stores the
 * provider's own asset id and nothing that re-points at the media.** A
 * plan is exportable and shareable, so a download URL inside one is a
 * leak with legs, and it expires besides. `assertClipCarriesNoMediaUrl`
 * is that rule made executable at runtime rather than a comment, and
 * `footage.test.ts` and `runners.test.ts` both sabotage the plan on
 * purpose to prove it fires.
 *
 * Both libraries' terms are settled and recorded on card 10: neither
 * requires attribution in the exported video, both permit derivative
 * works (crop to 9:16, trim) and commercial use including selling the
 * result, and both rate limits sit far above one video's needs. The one
 * behavioural requirement that lands in code is Pixabay's 24-hour
 * response cache, implemented here and wired into the Pixabay adapter
 * only — a Pexels response is not cached by that adapter.
 */
import type { StockFootage } from "@shortreelcuts/plan";
import type { FootageConnection, StockClipCandidate } from "../types.js";

/** A non-2xx response from a stock library. The message carries the status only — never the URL, which holds the key on Pixabay. */
export class FootageProviderRequestError extends Error {
  readonly providerId: string;
  readonly status: number;

  constructor(providerId: string, status: number, statusText: string) {
    super(`stock footage request to ${providerId} failed: ${status} ${statusText}`);
    this.name = "FootageProviderRequestError";
    this.providerId = providerId;
    this.status = status;
  }
}

/** A 2xx response that is not the documented shape. Thrown rather than coerced into a zero-length clip. */
export class FootageProviderParseError extends Error {
  readonly providerId: string;
  readonly rawContent: string;

  constructor(providerId: string, rawContent: string, cause: unknown) {
    super(`the stock footage response from ${providerId} did not carry a parseable clip list`);
    this.name = "FootageProviderParseError";
    this.providerId = providerId;
    this.rawContent = rawContent;
    this.cause = cause;
  }
}

/** A clip that carries something a shareable plan must not: a media URL anywhere, including smuggled in as an `assetId`. */
export class PlanMediaUrlLeakError extends Error {
  constructor(providerId: string, detail: string) {
    super(
      `refusing to record a ${providerId} clip whose plan entry ${detail}; ` +
        "a plan stores the library's asset id only, and re-resolves the media URL at render time",
    );
    this.name = "PlanMediaUrlLeakError";
  }
}

/** A short, human-readable excerpt of a response for the parse error — never more than the first 512 bytes. */
export function responseExcerpt(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 512));
}

function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/**
 * A URL *anywhere* in the string, not merely at the start.
 *
 * This distinction is the whole point, and it was a real leak: the old
 * start-anchored test let a download URL through when it was embedded in
 * free text rather than standing alone. The two places that happened were
 * a candidate's `label` (a string the adapter composes) and the plan's
 * `reason`, which quotes that label verbatim — so a CDN link would have
 * reached a shareable plan with the citation in prose. A field that is not
 * supposed to hold a URL must not hold one in any position.
 */
function containsUrl(value: string): boolean {
  return /https?:\/\//i.test(value);
}

/**
 * True when a value is one bare URL and nothing else — no trailing prose,
 * no second link hiding behind it. An allow-listed host check alone is not
 * enough, because `new URL` parses happily through whatever junk follows and
 * reports only the first host, so `"https://www.pexels.com/x/ (https://cdn…/y.mp4)"`
 * would otherwise be read as a clean Pexels citation.
 */
function isBareUrl(value: string): boolean {
  if (!isAbsoluteHttpUrl(value)) return false;
  if (/\s/.test(value)) return false;
  return (value.match(/https?:\/\//gi) ?? []).length === 1;
}

/** The allow-listed-host check, applied to the one field permitted to hold a URL. */
function assertAllowListedPageUrl(providerId: string, pageUrl: string, allowed: Set<string>): void {
  if (!isBareUrl(pageUrl)) {
    if (containsUrl(pageUrl)) throw new PlanMediaUrlLeakError(providerId, "credits a source page that is not a bare URL");
    return;
  }
  const host = hostOf(pageUrl);
  if (!host || !allowed.has(host)) {
    throw new PlanMediaUrlLeakError(providerId, `credits a source page on a non-allow-listed host (${host ?? "unparseable"})`);
  }
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return undefined;
  }
}

function collectStringLeaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStringLeaves(item, out);
  else if (value && typeof value === "object") {
    for (const nested of Object.values(value)) collectStringLeaves(nested, out);
  }
  return out;
}

/**
 * The load-bearing assertion. Walks every string in a stock clip and
 * rejects any that is a URL other than the one allow-listed `credit.pageUrl`
 * — which is how an adapter that accidentally returns a CDN link in a
 * field nobody expected, or a plan that had a download URL pasted into
 * `assetId`, fails the stage instead of shipping.
 *
 * `pageUrl` itself is the exception, and it is checked rather than
 * trusted: it must sit on one of `allowedHosts`, so a media host cannot
 * launder itself through the one field that is allowed to hold a URL.
 */
export function assertClipCarriesNoMediaUrl(clip: StockFootage, allowedHosts: readonly string[]): void {
  const allowed = new Set(allowedHosts.map((host) => host.toLowerCase()));
  for (const leaf of collectStringLeaves(clip)) {
    if (leaf === clip.credit.pageUrl) continue;
    if (containsUrl(leaf)) throw new PlanMediaUrlLeakError(clip.provider, `carries a URL (${hostOf(leaf) ?? "unparseable"})`);
  }

  assertAllowListedPageUrl(clip.provider, clip.credit.pageUrl, allowed);

  if (isAbsoluteHttpUrl(clip.assetId)) {
    throw new PlanMediaUrlLeakError(clip.provider, "uses a URL as its asset id");
  }
}

/**
 * The same rule applied to a *candidate*, before one is chosen.
 *
 * The clip assertion alone is not enough, and the gap is not theoretical:
 * the stage records every candidate the library returned, and those go to
 * the decision sheet and to the database alongside the plan. So a provider
 * that leaked a CDN link in only its third candidate — the one the seed
 * did not happen to pick — would pass the clip assertion and still put a
 * re-hostable download URL into a stored, shareable artifact. Asserting on
 * the whole set is what makes the guarantee about the artifact rather than
 * about the winner.
 *
 * `label` is checked too, precisely because it is a free-text field an
 * adapter composes rather than copies.
 */
export function assertCandidateCarriesNoMediaUrl(candidate: StockClipCandidate, providerId: string, allowedHosts: readonly string[]): void {
  const allowed = new Set(allowedHosts.map((host) => host.toLowerCase()));
  for (const leaf of collectStringLeaves(candidate)) {
    if (leaf === candidate.credit.pageUrl) continue;
    if (containsUrl(leaf)) {
      throw new PlanMediaUrlLeakError(providerId, `offers a candidate carrying a URL (${hostOf(leaf) ?? "embedded"})`);
    }
  }

  assertAllowListedPageUrl(providerId, candidate.credit.pageUrl, allowed);

  if (isAbsoluteHttpUrl(candidate.assetId)) {
    throw new PlanMediaUrlLeakError(providerId, "offers a candidate that uses a URL as its asset id");
  }
}

/**
 * Pixabay requires the caller to respect a 24-hour response cache — the
 * same search must not be re-fetched inside that window. Implemented as an
 * in-memory, time-aware cache injected into the adapter, with the clock as
 * a parameter so a test can prove the window without waiting a day.
 *
 * Caching the *response's clip list* (ids, labels, durations) rather than
 * bytes: the media is re-resolved per render, and a cached byte blob in
 * memory would be exactly the thing the plan is forbidden to hold.
 */
export const RESPONSE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface ResponseCache {
  get(key: string): readonly unknown[] | undefined;
  set(key: string, value: readonly unknown[]): void;
}

export function createMemoryResponseCache(now: () => number = Date.now, ttlMs: number = RESPONSE_CACHE_TTL_MS): ResponseCache {
  const entries = new Map<string, { expiresAt: number; value: readonly unknown[] }>();
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      entries.set(key, { expiresAt: now() + ttlMs, value });
    },
  };
}

/** Strips a trailing slash so a base URL and a path never produce a doubled separator. */
export function joinBase(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export const PEXELS_DEFAULT_BASE_URL = "https://api.pexels.com";
export const PIXABAY_DEFAULT_BASE_URL = "https://pixabay.com/api";

export class InvalidFootageBaseUrlError extends Error {
  constructor(baseURL: string) {
    super(
      `the configured stock footage base URL is not an absolute http(s) URL: ${baseURL}. ` +
        "Leave SHORTREELCUTS_FOOTAGE_BASE_URL unset to use the library's own host.",
    );
    this.name = "InvalidFootageBaseUrlError";
  }
}

/** Validated once, at boot, so a typo in a base URL fails the worker starting rather than a render half an hour in. */
export function assertValidBaseUrl(baseURL: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseURL);
  } catch {
    throw new InvalidFootageBaseUrlError(baseURL);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new InvalidFootageBaseUrlError(baseURL);
  return baseURL;
}

/**
 * The credential a real stock adapter is built from. Resolved from the
 * environment by `resolveFootageConnection` (`connection.ts`) and never
 * written into a plan: `apiKey` reaches the request and nothing else.
 */
export interface RemoteStockConnection {
  readonly providerId: string;
  readonly apiKey: string;
  readonly baseURL: string;
}

export function remoteStockConnectionFrom(connection: FootageConnection): RemoteStockConnection {
  return {
    providerId: connection.provider,
    apiKey: connection.apiKey,
    baseURL: assertValidBaseUrl(connection.baseURL ?? defaultBaseUrlFor(connection.provider)),
  };
}

function defaultBaseUrlFor(provider: string): string {
  switch (provider) {
    case "pexels":
      return PEXELS_DEFAULT_BASE_URL;
    case "pixabay":
      return PIXABAY_DEFAULT_BASE_URL;
    default:
      throw new UnknownStockProviderError(provider);
  }
}

/** A `SHORTREELCUTS_FOOTAGE_PROVIDER` this build has no adapter for. Rejected rather than silently falling back to a stub. */
export class UnknownStockProviderError extends Error {
  constructor(providerId: string) {
    super(
      `no stock footage adapter exists for provider "${providerId}". This build ships ${KNOWN_STOCK_PROVIDERS.join(" and ")}.`,
    );
    this.name = "UnknownStockProviderError";
  }
}

/**
 * The providers this build ships, and the only values
 * `SHORTREELCUTS_FOOTAGE_PROVIDER` may take. **There is no default** — a
 * self-hoster picks, exactly as they pick a model for script and voice,
 * and nothing here guesses for them.
 */
export const KNOWN_STOCK_PROVIDERS = ["pexels", "pixabay"] as const;

export type KnownStockProvider = (typeof KNOWN_STOCK_PROVIDERS)[number];
