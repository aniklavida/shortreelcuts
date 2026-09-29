/**
 * Proves the Pexels adapter's plumbing against a controlled local HTTP
 * server standing in for "a stock library" — the same technique
 * `voice/openAiCompatible.test.ts` and `runners.test.ts` use, and the
 * reason no test here ever reaches the real api.pexels.com.
 *
 * The three things these tests exist to catch, in order of how much they
 * would cost:
 *
 * 1. A media URL reaching a plan. The mock deliberately puts its download
 *    links in `video_files[].link`, exactly as Pexels does, and every
 *    candidate and every resolved clip is checked for their absence.
 * 2. The API key reaching the plan, a candidate, an error message or the
 *    console.
 * 3. A bad response quietly becoming a clip instead of a loud failure.
 */
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StockFootage } from "@shortreelcuts/plan";
import type { StockSearchRequest, StockClipCandidate } from "../types.js";
import { createPexelsFootageProvider } from "./pexels.js";
import {
  assertCandidateCarriesNoMediaUrl,
  assertClipCarriesNoMediaUrl,
  FootageProviderParseError,
  FootageProviderRequestError,
  PlanMediaUrlLeakError,
} from "./remoteStock.js";

// Shaped like a test fixture, not a real provider key prefix — the repository's own CI scans for those.
const SECRET_KEY = "TEST-FAKE-CREDENTIAL-DO-NOT-LEAK-4f9c2";
const DOWNLOAD_LINK = "https://videos.pexels.com/video-files/1234567/1234567-hd_1920_1080_30fps.mp4";
const DOWNLOAD_LINK_1280 = "https://videos.pexels.com/video-files/1234567/1234567-hd_1280_720_30fps.mp4";
const DOWNLOAD_LINK_720 = "https://videos.pexels.com/video-files/1234567/1234567-sd_720_540_30fps.mp4";

const REQUEST: StockSearchRequest = {
  beatId: "b1",
  search: "mountain tea harvest",
  count: 2,
  targetSeconds: 4,
  orientation: "portrait",
};

interface PexelsHit {
  id: number;
  duration: number;
  url: string;
  user: { name: string };
  video_files: { id: number; file_type: string; width: number; height: number; link: string }[];
}

function pexelsVideo(id: number, width = 1920, fileType = "video/mp4"): PexelsHit {
  return {
    id,
    duration: 8.5,
    url: `https://www.pexels.com/video/a-climb-in-the-mist-${id}/`,
    user: { name: "Rowan Ito" },
    video_files: [
      { id: 1, file_type: "image/jpeg", width: 1260, height: 720, link: "https://images.pexels.com/photos/poster.jpg" },
      { id: 2, file_type: fileType, width, height: 1080, link: DOWNLOAD_LINK },
      { id: 3, file_type: fileType, width: 1280, height: 720, link: DOWNLOAD_LINK_1280 },
      { id: 4, file_type: fileType, width: 720, height: 540, link: DOWNLOAD_LINK_720 },
    ],
  };
}

describe("createPexelsFootageProvider", () => {
  let server: Server;
  let baseURL: string;
  let lastAuthHeader: string | undefined;
  let lastPath: string | undefined;
  let lastQuery: URLSearchParams | undefined;
  let respondWith: () => { status: number; body: string; contentType: string };

  const provider = () => createPexelsFootageProvider({ providerId: "pexels", apiKey: SECRET_KEY, baseURL });

  beforeEach(async () => {
    lastAuthHeader = "unset";
    lastPath = undefined;
    lastQuery = undefined;
    respondWith = () => ({
      status: 200,
      body: JSON.stringify({ page: 1, per_page: 2, total_results: 2, videos: [pexelsVideo(111), pexelsVideo(222)] }),
      contentType: "application/json",
    });
    server = createServer((req, res) => {
      lastAuthHeader = req.headers["authorization"];
      lastPath = req.url;
      lastQuery = new URL(req.url ?? "", "http://127.0.0.1").searchParams;
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
    expect(provider().id).toBe("pexels");
    expect(provider().planUrlHosts).toContain("www.pexels.com");
    expect(provider().planUrlHosts).not.toContain("videos.pexels.com");
  });

  it("sends the key as a header and asks for the scene's search, count and orientation", async () => {
    const candidates = await provider().search(REQUEST);

    expect(lastAuthHeader).toBe(SECRET_KEY);
    expect(new URL(lastPath ?? "", "http://127.0.0.1").pathname).toBe("/videos/search");
    expect(lastQuery?.get("query")).toBe("mountain tea harvest");
    expect(lastQuery?.get("per_page")).toBe("2");
    expect(lastQuery?.get("orientation")).toBe("portrait");
    expect(candidates.map((c) => c.assetId)).toEqual(["111", "222"]);
    expect(candidates[0]?.durationSeconds).toBe(8.5);
    expect(candidates[0]?.label).toContain("mountain tea harvest");
    expect(candidates[0]?.credit).toEqual({
      creator: "Rowan Ito",
      pageUrl: "https://www.pexels.com/video/a-climb-in-the-mist-111/",
    });
  });

  it("never puts the library's download link into a candidate", async () => {
    const candidates = await provider().search(REQUEST);
    const serialised = JSON.stringify(candidates);

    expect(serialised).not.toContain(DOWNLOAD_LINK);
    expect(serialised).not.toContain(DOWNLOAD_LINK_1280);
    expect(serialised).not.toContain(DOWNLOAD_LINK_720);
    expect(serialised).not.toContain("videos.pexels.com");
    expect(serialised).not.toContain("images.pexels.com");
    for (const candidate of candidates) {
      // The candidate shape is the whole contract: id, label, duration, credit.
      expect(Object.keys(candidate).sort()).toEqual(["assetId", "credit", "durationSeconds", "label"]);
    }
  });

  it("skips a hit with no id, because an unidentifiable clip cannot be re-resolved later", async () => {
    respondWith = () => ({
      status: 200,
      body: JSON.stringify({ videos: [{ duration: 3 }, pexelsVideo(222)] }),
      contentType: "application/json",
    });

    const candidates = await provider().search(REQUEST);

    expect(candidates.map((c) => c.assetId)).toEqual(["222"]);
  });

  it("re-resolves a stored asset id to a media URL at resolve time, choosing the smallest 1080-wide MP4", async () => {
    respondWith = () => ({ status: 200, body: JSON.stringify(pexelsVideo(111)), contentType: "application/json" });

    const mediaUrl = await provider().resolveMediaUrl("111");

    expect(new URL(lastPath ?? "", "http://127.0.0.1").pathname).toBe("/videos/videos/111");
    expect(lastAuthHeader).toBe(SECRET_KEY);
    // 1280 is the smallest rendition still wide enough for a 1080-wide
    // render; the 1920 source is not downloaded to make a 9:16 video.
    expect(mediaUrl).toBe(DOWNLOAD_LINK_1280);
  });

  it("falls back to the widest MP4 when none is 1080 pixels wide", async () => {
    respondWith = () => ({
      status: 200,
      body: JSON.stringify({
        id: 111,
        video_files: [
          { id: 1, file_type: "video/mp4", width: 960, link: DOWNLOAD_LINK_720 },
          { id: 2, file_type: "video/mp4", width: 640, link: "https://videos.pexels.com/tiny.mp4" },
        ],
      }),
      contentType: "application/json",
    });

    await expect(provider().resolveMediaUrl("111")).resolves.toBe(DOWNLOAD_LINK_720);
  });

  it("throws FootageProviderRequestError on a non-2xx, with no key in the message", async () => {
    respondWith = () => ({ status: 401, body: JSON.stringify({ error: "invalid key" }), contentType: "application/json" });

    const failure = provider().search(REQUEST);
    await expect(failure).rejects.toBeInstanceOf(FootageProviderRequestError);
    await expect(failure).rejects.not.toThrow(new RegExp(SECRET_KEY));
    await expect(failure).rejects.not.toThrow(new RegExp("videos.pexels.com"));
  });

  it("throws FootageProviderParseError, rather than proposing nothing, on a 2xx that is not the documented shape", async () => {
    respondWith = () => ({ status: 200, body: "<html>maintenance</html>", contentType: "text/html" });

    await expect(provider().search(REQUEST)).rejects.toBeInstanceOf(FootageProviderParseError);
  });

  it("throws rather than resolving a clip whose video files carry no usable MP4", async () => {
    respondWith = () => ({
      status: 200,
      body: JSON.stringify({ id: 111, duration: 8, video_files: [{ file_type: "image/jpeg", link: "https://images.pexels.com/x.jpg" }] }),
      contentType: "application/json",
    });

    await expect(provider().resolveMediaUrl("111")).rejects.toBeInstanceOf(FootageProviderParseError);
  });

  it("never lets the API key reach a candidate, a resolved URL, or the console", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );

    try {
      const stock = provider();
      const candidates = await stock.search(REQUEST);
      respondWith = () => ({ status: 200, body: JSON.stringify(pexelsVideo(111)), contentType: "application/json" });
      const mediaUrl = await stock.resolveMediaUrl("111");

      expect(JSON.stringify(candidates)).not.toContain(SECRET_KEY);
      expect(mediaUrl).not.toContain(SECRET_KEY);
      expect(lastPath ?? "").not.toContain(SECRET_KEY);
      for (const spy of spies) {
        for (const call of spy.mock.calls) expect(call.join(" ")).not.toContain(SECRET_KEY);
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe("assertClipCarriesNoMediaUrl", () => {
  const hosts = ["www.pexels.com", "pexels.com"];
  const honest = {
    source: "stock",
    provider: "pexels",
    assetId: "111",
    in: 0,
    out: 4,
    credit: { creator: "Rowan Ito", pageUrl: "https://www.pexels.com/video/a-climb-in-the-mist-111/" },
    reason: "because",
  } as const;

  it("accepts a clip that carries only the asset id and the library's own page", () => {
    expect(() => assertClipCarriesNoMediaUrl(honest, hosts)).not.toThrow();
  });

  it("catches a download URL pasted into the asset id — the exact sabotage this rule exists for", () => {
    const sabotaged = { ...honest, assetId: DOWNLOAD_LINK } as unknown as StockFootage;
    expect(() => assertClipCarriesNoMediaUrl(sabotaged, hosts)).toThrow(PlanMediaUrlLeakError);
  });

  it("catches a download URL smuggled into any other field of the clip", () => {
    const sabotaged = { ...honest, downloadUrl: DOWNLOAD_LINK } as unknown as StockFootage;
    expect(() => assertClipCarriesNoMediaUrl(sabotaged, hosts)).toThrow(PlanMediaUrlLeakError);
  });

  it("catches a credit page hosted on the library's own media CDN", () => {
    const sabotaged = { ...honest, credit: { creator: "Rowan Ito", pageUrl: DOWNLOAD_LINK } } as unknown as StockFootage;
    expect(() => assertClipCarriesNoMediaUrl(sabotaged, hosts)).toThrow(PlanMediaUrlLeakError);
  });

  it("catches a credit page on a third party's host", () => {
    const sabotaged = { ...honest, credit: { creator: "Rowan Ito", pageUrl: "https://rehost.example/111.mp4" } } as unknown as StockFootage;
    expect(() => assertClipCarriesNoMediaUrl(sabotaged, hosts)).toThrow(PlanMediaUrlLeakError);
  });

  it("catches a download URL embedded mid-string rather than standing alone", () => {
    // The reason is the field that made this a real hole: the stage quotes
    // the candidate's label into it, so a link buried in free text reached a
    // shareable plan in prose while every start-anchored check passed.
    const sabotaged = {
      ...honest,
      reason: `Selected stock clip "a climb (${DOWNLOAD_LINK})" as the closest of 4 clips.`,
    } as unknown as StockFootage;
    expect(() => assertClipCarriesNoMediaUrl(sabotaged, hosts)).toThrow(PlanMediaUrlLeakError);
  });

  it("catches a credit page that trails prose after the URL", () => {
    const sabotaged = {
      ...honest,
      credit: { creator: "Rowan Ito", pageUrl: `https://www.pexels.com/video/a-climb-111/ (${DOWNLOAD_LINK})` },
    } as unknown as StockFootage;
    expect(() => assertClipCarriesNoMediaUrl(sabotaged, hosts)).toThrow(PlanMediaUrlLeakError);
  });
});

describe("assertCandidateCarriesNoMediaUrl", () => {
  const hosts = ["www.pexels.com", "pexels.com"];
  const honest: StockClipCandidate = {
    assetId: "111",
    label: "blue sky — Pexels 111 (6s)",
    durationSeconds: 6,
    credit: { creator: "Rowan Ito", pageUrl: "https://www.pexels.com/video/a-climb-in-the-mist-111/" },
  };

  it("accepts a candidate that carries only the asset id and the library's own page", () => {
    expect(() => assertCandidateCarriesNoMediaUrl(honest, "pexels", hosts)).not.toThrow();
  });

  it("catches a download URL as the asset id", () => {
    expect(() => assertCandidateCarriesNoMediaUrl({ ...honest, assetId: DOWNLOAD_LINK }, "pexels", hosts)).toThrow(
      PlanMediaUrlLeakError,
    );
  });

  it("catches a download URL embedded in the free-text label", () => {
    expect(() => assertCandidateCarriesNoMediaUrl({ ...honest, label: `a climb (${DOWNLOAD_LINK})` }, "pexels", hosts)).toThrow(
      PlanMediaUrlLeakError,
    );
  });

  it("catches a download URL smuggled into a field nobody expected", () => {
    const sabotaged = { ...honest, previewUrl: DOWNLOAD_LINK } as unknown as StockClipCandidate;
    expect(() => assertCandidateCarriesNoMediaUrl(sabotaged, "pexels", hosts)).toThrow(PlanMediaUrlLeakError);
  });

  it("catches a credit page laundered onto the media CDN", () => {
    expect(() =>
      assertCandidateCarriesNoMediaUrl({ ...honest, credit: { creator: "Rowan Ito", pageUrl: DOWNLOAD_LINK } }, "pexels", hosts),
    ).toThrow(PlanMediaUrlLeakError);
  });
});
