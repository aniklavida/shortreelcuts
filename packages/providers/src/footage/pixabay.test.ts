/**
 * Proves the Pixabay adapter's plumbing against a controlled local HTTP
 * server standing in for "a stock library", never the real pixabay.com.
 *
 * Two things are specific to Pixabay and are proved here rather than
 * assumed:
 *
 * - **The key travels in the query string**, which is Pixabay's
 *   authentication scheme and means the request URL *is* the credential.
 *   So no error thrown from the adapter may quote a URL, and this file
 *   checks the failure messages and the console for the key on top of the
 *   plan and candidates.
 * - **The 24-hour response cache Pixabay's terms require.** The clock is
 *   injected, so "the same search is not re-fetched inside 24 hours" is a
 *   fast deterministic test rather than a claim.
 */
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StockSearchRequest } from "../types.js";
import { createPixabayFootageProvider } from "./pixabay.js";
import {
  FootageProviderParseError,
  FootageProviderRequestError,
  RESPONSE_CACHE_TTL_MS,
  createMemoryResponseCache,
} from "./remoteStock.js";

const SECRET_KEY = "TEST-FAKE-CREDENTIAL-DO-NOT-LEAK-4f9c2";
const CDN_LARGE = "https://cdn.pixabay.com/video/2015/08/08/125-135736646_large.mp4";
const CDN_MEDIUM = "https://cdn.pixabay.com/video/2015/08/08/125-135736646_medium.mp4";

const REQUEST: StockSearchRequest = {
  beatId: "b1",
  search: "mountain tea harvest",
  count: 2,
  targetSeconds: 4,
  orientation: "portrait",
};

function pixabayHit(id: number) {
  return {
    id,
    pageURL: `https://pixabay.com/videos/id-${id}/`,
    type: "film",
    tags: "mountain, tea",
    duration: 11,
    user: "Amara Odell",
    videos: {
      large: { url: CDN_LARGE, width: 1920, height: 1080, size: 6_615_235, thumbnail: "https://cdn.pixabay.com/x.jpg" },
      medium: { url: CDN_MEDIUM, width: 1280, height: 720, size: 2_000_000, thumbnail: "https://cdn.pixabay.com/y.jpg" },
      small: { url: "https://cdn.pixabay.com/small.mp4", width: 960, height: 540, size: 900_000 },
    },
  };
}

describe("createPixabayFootageProvider", () => {
  let server: Server;
  let baseURL: string;
  let requestedURLs: string[];
  let respondWith: () => { status: number; body: string; contentType: string };

  const provider = (options: { now?: () => number } = {}) =>
    createPixabayFootageProvider(
      { providerId: "pixabay", apiKey: SECRET_KEY, baseURL },
      options.now ? { now: options.now } : {},
    );

  beforeEach(async () => {
    requestedURLs = [];
    respondWith = () => ({
      status: 200,
      body: JSON.stringify({ total: 2, totalHits: 2, hits: [pixabayHit(125), pixabayHit(126)] }),
      contentType: "application/json",
    });
    server = createServer((req, res) => {
      requestedURLs.push(req.url ?? "");
      const { status, body, contentType } = respondWith();
      res.writeHead(status, { "content-type": contentType });
      res.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("expected an AddressInfo");
    baseURL = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("declares its own identity and the only hosts a plan URL may sit on", () => {
    expect(provider().id).toBe("pixabay");
    expect(provider().planUrlHosts).toContain("pixabay.com");
    expect(provider().planUrlHosts).not.toContain("cdn.pixabay.com");
  });

  it("searches the video endpoint with the key, the scene's search term and its count", async () => {
    const candidates = await provider().search(REQUEST);

    const url = new URL(requestedURLs[0] ?? "", "http://127.0.0.1");
    expect(url.pathname).toBe("/videos/");
    expect(url.searchParams.get("key")).toBe(SECRET_KEY);
    expect(url.searchParams.get("q")).toBe("mountain tea harvest");
    expect(url.searchParams.get("per_page")).toBe("2");
    expect(url.searchParams.get("safesearch")).toBe("true");
    expect(candidates.map((c) => c.assetId)).toEqual(["125", "126"]);
    expect(candidates[0]?.credit).toEqual({ creator: "Amara Odell", pageUrl: "https://pixabay.com/videos/id-125/" });
    expect(candidates[0]?.label).toContain("mountain tea harvest");
  });

  it("never puts the library's CDN link into a candidate", async () => {
    const candidates = await provider().search(REQUEST);
    const serialised = JSON.stringify(candidates);

    expect(serialised).not.toContain("cdn.pixabay.com");
    expect(serialised).not.toContain(CDN_LARGE);
    expect(serialised).not.toContain(CDN_MEDIUM);
    for (const candidate of candidates) {
      expect(Object.keys(candidate).sort()).toEqual(["assetId", "credit", "durationSeconds", "label"]);
    }
  });

  it("serves the same search from cache for 24 hours, then re-fetches — Pixabay's terms require it", async () => {
    let now = 1_700_000_000_000;
    const stock = provider({ now: () => now });

    const first = await stock.search(REQUEST);
    const second = await stock.search(REQUEST);
    expect(requestedURLs).toHaveLength(1);
    expect(second).toEqual(first);

    // Nine seconds short of the window: still cached, because the point of
    // the rule is that nothing is re-fetched inside it.
    now += RESPONSE_CACHE_TTL_MS - 1_000;
    await stock.search(REQUEST);
    expect(requestedURLs).toHaveLength(1);

    now += 2_000;
    await stock.search(REQUEST);
    expect(requestedURLs).toHaveLength(2);
  });

  it("caches per search term, so a different scene still reaches the library", async () => {
    const stock = provider();
    await stock.search(REQUEST);
    await stock.search({ ...REQUEST, search: "river sea" });
    expect(requestedURLs).toHaveLength(2);
  });

  it("re-resolves a stored asset id to a media URL at resolve time, by asking for that id", async () => {
    const mediaUrl = await provider().resolveMediaUrl("125");

    const url = new URL(requestedURLs[0] ?? "", "http://127.0.0.1");
    expect(url.pathname).toBe("/videos/");
    expect(url.searchParams.get("id")).toBe("125");
    // The smallest rendition still 1080 pixels wide, so a 1080-wide render
    // never downloads the 1920 source for it.
    expect(mediaUrl).toBe(CDN_MEDIUM);
  });

  it("throws FootageProviderRequestError on a non-2xx, quoting neither the key nor the URL that carries it", async () => {
    respondWith = () => ({ status: 429, body: JSON.stringify({ error: "rate limited" }), contentType: "application/json" });

    const failure = provider().search(REQUEST);
    await expect(failure).rejects.toBeInstanceOf(FootageProviderRequestError);
    await expect(failure).rejects.not.toThrow(new RegExp(SECRET_KEY));
    await expect(failure).rejects.not.toThrow(new RegExp("[?]key="));
  });

  it("throws FootageProviderParseError, rather than proposing nothing, on a 2xx that is not the documented shape", async () => {
    respondWith = () => ({ status: 200, body: "<html>maintenance</html>", contentType: "text/html" });
    await expect(provider().search(REQUEST)).rejects.toBeInstanceOf(FootageProviderParseError);

    respondWith = () => ({ status: 200, body: JSON.stringify({ items: [] }), contentType: "application/json" });
    await expect(provider().search(REQUEST)).rejects.toBeInstanceOf(FootageProviderParseError);
  });

  it("throws rather than resolving an asset the library returned with no usable rendition", async () => {
    respondWith = () => ({
      status: 200,
      body: JSON.stringify({ hits: [{ id: 125, videos: { small: { url: "", width: 960 } } }] }),
      contentType: "application/json",
    });

    await expect(provider().resolveMediaUrl("125")).rejects.toBeInstanceOf(FootageProviderParseError);
  });

  it("never lets the API key reach a candidate, a resolved URL or the console", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );

    try {
      const stock = provider();
      const candidates = await stock.search(REQUEST);
      const mediaUrl = await stock.resolveMediaUrl("125");

      expect(JSON.stringify(candidates)).not.toContain(SECRET_KEY);
      expect(mediaUrl).not.toContain(SECRET_KEY);
      for (const spy of spies) {
        for (const call of spy.mock.calls) expect(call.join(" ")).not.toContain(SECRET_KEY);
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe("createMemoryResponseCache", () => {
  it("expires entries exactly at the window, and reports nothing after it", () => {
    let now = 0;
    const cache = createMemoryResponseCache(() => now, 1_000);
    cache.set("q", [{ assetId: "1" }]);

    expect(cache.get("q")).toEqual([{ assetId: "1" }]);
    now = 999;
    expect(cache.get("q")).toEqual([{ assetId: "1" }]);
    now = 1_000;
    expect(cache.get("q")).toBeUndefined();
  });
});
