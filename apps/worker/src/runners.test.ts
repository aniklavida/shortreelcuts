/**
 * Proves the script, voice and footage wiring in `defaultRunners`: a
 * configured connection drives the real provider, no connection gets the
 * explicitly marked stub, a bad response fails loudly instead of falling
 * back, and the configured key reaches neither the plan nor the logs.
 *
 * The model, the speech endpoint and the stock library are controlled
 * local HTTP servers standing in for any real one — the same technique
 * `openAiCompatible.test.ts` uses, and the same one that makes a hosted
 * BYOK key and a local runtime one request shape (`docs/SPEC.md` §5.1).
 * No test in this repository calls a real provider over the network.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Brief, Plan } from "@shortreelcuts/plan";
import {
  MissingFootageApiKeyError,
  PlanMediaUrlLeakError,
  UnknownFootageProviderError,
} from "@shortreelcuts/providers";
import {
  createVoiceRunner,
  FootageSearchError,
  ScriptGenerationError,
  VoiceGenerationError,
  runFootage,
} from "@shortreelcuts/stages";
import { defaultRunners } from "./runners.js";

const BRIEF: Brief = { prompt: "why the ocean is salty", targetSeconds: 20, tone: "calm" };
// Shaped like a test fixture, not a real provider key prefix — the repository's own CI scans for those.
const SECRET_KEY = "TEST-FAKE-CREDENTIAL-DO-NOT-LEAK-4f9c2";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function chatCompletion(content: string): unknown {
  return { choices: [{ message: { content } }] };
}

describe("defaultRunners script wiring", () => {
  let server: Server;
  let baseURL: string;
  let lastAuthHeader: string | undefined;
  let lastRequestBody: string;
  let respondWith: () => { status: number; body: unknown };

  beforeEach(async () => {
    respondWith = () => ({
      status: 200,
      body: chatCompletion('{"hook":"Salty because of rocks","beats":["b1","b2"],"reason":"question-first"}'),
    });
    lastAuthHeader = "unset";
    lastRequestBody = "";
    server = createServer(async (req, res) => {
      lastAuthHeader = req.headers["authorization"];
      lastRequestBody = await readBody(req);
      const { status, body } = respondWith();
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("expected an AddressInfo");
    baseURL = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("uses the real provider when a local connection is configured", async () => {
    const runners = defaultRunners({
      env: { SHORTREELCUTS_MODEL_BASE_URL: baseURL, SHORTREELCUTS_MODEL_NAME: "test-model" },
    });

    const result = await runners.script({ brief: BRIEF, seed: 1 });

    expect(result.patch.script.hook).toBe("Salty because of rocks");
    expect(result.patch.script.beats).toHaveLength(2);
    expect(result.patch.script.reason).toContain("connected model");
    const candidate = result.candidates["script.hook"]?.find((c) => c.chosen);
    expect(candidate?.label).toBe("Salty because of rocks");
    // The local path carries no credential at all.
    expect(lastAuthHeader).toBeUndefined();
  });

  it("sends a byok key as a bearer token and keeps it out of the plan and candidates", async () => {
    const runners = defaultRunners({
      env: {
        SHORTREELCUTS_MODEL_BASE_URL: baseURL,
        SHORTREELCUTS_MODEL_NAME: "test-model",
        SHORTREELCUTS_MODEL_API_KEY: SECRET_KEY,
      },
    });

    const result = await runners.script({ brief: BRIEF, seed: 1 });

    expect(lastAuthHeader).toBe(`Bearer ${SECRET_KEY}`);
    expect(JSON.stringify(result.patch)).not.toContain(SECRET_KEY);
    expect(JSON.stringify(result.candidates)).not.toContain(SECRET_KEY);
    expect(lastRequestBody).not.toContain(SECRET_KEY);
  });

  it("falls back to the marked stub when no connection is configured", async () => {
    const runners = defaultRunners({ env: {} });

    const result = await runners.script({ brief: BRIEF, seed: 1 });

    expect(result.patch.script.reason).toContain("stub");
    expect(result.patch.script.reason).toContain("no model was called");
    // No request left the process: this was the stub, not a silent real call.
    expect(lastRequestBody).toBe("");
    expect(lastAuthHeader).toBe("unset");
  });

  it("fails loudly instead of falling back to the stub when the model's output does not parse", async () => {
    respondWith = () => ({ status: 200, body: chatCompletion("Cats purr because they are happy.") });
    const runners = defaultRunners({
      env: { SHORTREELCUTS_MODEL_BASE_URL: baseURL, SHORTREELCUTS_MODEL_NAME: "test-model" },
    });

    await expect(runners.script({ brief: BRIEF, seed: 1 })).rejects.toBeInstanceOf(ScriptGenerationError);
  });

  it("never writes the configured key to the console while generating", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );

    try {
      // Spied across both wiring (connection resolution at construction) and generation.
      const runners = defaultRunners({
        env: {
          SHORTREELCUTS_MODEL_BASE_URL: baseURL,
          SHORTREELCUTS_MODEL_NAME: "test-model",
          SHORTREELCUTS_MODEL_API_KEY: SECRET_KEY,
        },
      });
      await runners.script({ brief: BRIEF, seed: 1 });
      for (const spy of spies) {
        for (const call of spy.mock.calls) {
          expect(call.join(" ")).not.toContain(SECRET_KEY);
        }
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

function fixturePlan(): Plan {
  return {
    planVersion: 2,
    seed: 41207,
    brief: BRIEF,
    script: {
      hook: "Why is the ocean salty?",
      beats: [
        { id: "b1", narration: "Rain erodes rocks.", onScreen: "Rain", search: "rain rocks" },
        { id: "b2", narration: "Minerals flow to sea.", onScreen: "Minerals", search: "river sea" },
      ],
      reason: "simple explainer",
    },
    voice: { provider: "stub", voiceId: "warm-female", rate: 1.0, reason: "stub voice" },
    footage: {},
    align: { provider: "stub", words: {}, reason: "stub align" },
    captions: { style: "clean", position: "lower-third", wordsPerCue: 3, reason: "clean captions" },
    music: { enabled: false, volume: 0, reason: "no music" },
    format: { width: 1080, height: 1920, fps: 30, container: "mp4" },
  };
}

describe("defaultRunners voice wiring", () => {
  it("uses the real voice provider when a local connection is configured", async () => {
    const runners = defaultRunners({
      env: {
        SHORTREELCUTS_VOICE_BASE_URL: "http://127.0.0.1:5002/v1",
        SHORTREELCUTS_VOICE_NAME: "local-tts",
        SHORTREELCUTS_VOICE_IDS: "voice-a,voice-b",
      },
    });

    const result = await runners.voice({ plan: fixturePlan() });

    expect(result.patch.voice.provider).toBe("openai-compatible:local");
    expect(["voice-a", "voice-b"]).toContain(result.patch.voice.voiceId);
    expect(result.patch.voice.reason).toContain("openai-compatible:local");
    const candidates = result.candidates["voice.voiceId"];
    expect(candidates).toHaveLength(2);
    expect(candidates?.find((c) => c.chosen)?.id).toBe(result.patch.voice.voiceId);
  });

  it("uses the real voice provider with byok key and keeps it out of the plan and candidates", async () => {
    const runners = defaultRunners({
      env: {
        SHORTREELCUTS_VOICE_BASE_URL: "https://api.example.com/v1",
        SHORTREELCUTS_VOICE_NAME: "hosted-tts",
        SHORTREELCUTS_VOICE_API_KEY: SECRET_KEY,
        SHORTREELCUTS_VOICE_IDS: "alloy,nova",
      },
    });

    const result = await runners.voice({ plan: fixturePlan() });

    expect(result.patch.voice.provider).toBe("openai-compatible:byok");
    expect(JSON.stringify(result.patch)).not.toContain(SECRET_KEY);
    expect(JSON.stringify(result.candidates)).not.toContain(SECRET_KEY);
  });

  it("falls back to the marked stub when no voice connection is configured", async () => {
    const runners = defaultRunners({ env: {} });

    const result = await runners.voice({ plan: fixturePlan() });

    expect(result.patch.voice.provider).toBe("stub");
    expect(result.patch.voice.reason).toContain("stub");
    expect(result.patch.voice.reason).toContain("no speech engine was called");
  });

  it("fails loudly instead of falling back to the stub when the voice provider declares no voices", async () => {
    const mockProvider = {
      id: "empty-provider",
      voices: async () => [],
      speak: async () => [],
    };
    const runner = createVoiceRunner(mockProvider);
    await expect(runner({ plan: fixturePlan() })).rejects.toBeInstanceOf(VoiceGenerationError);
  });

  it("never writes the configured voice key to the console while generating", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );

    try {
      const runners = defaultRunners({
        env: {
          SHORTREELCUTS_VOICE_BASE_URL: "https://api.example.com/v1",
          SHORTREELCUTS_VOICE_NAME: "tts-1",
          SHORTREELCUTS_VOICE_API_KEY: SECRET_KEY,
          SHORTREELCUTS_VOICE_IDS: "alloy,nova",
        },
      });
      await runners.voice({ plan: fixturePlan() });
      for (const spy of spies) {
        for (const call of spy.mock.calls) {
          expect(call.join(" ")).not.toContain(SECRET_KEY);
        }
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

/**
 * The stock library the footage wiring talks to, answering in both
 * libraries' documented shapes on one port. Its download links are
 * deliberately distinctive so a test can assert they never appear in a
 * plan — that assertion is the point of the whole fixture.
 */
const PEXELS_DOWNLOAD = "https://videos.pexels.com/video-files/9/9-hd_1920_1080.mp4";
const PIXABAY_DOWNLOAD = "https://cdn.pixabay.com/video/2015/08/08/77-large.mp4";

function pexelsSearchBody(): unknown {
  return {
    videos: [
      {
        id: 111,
        duration: 9,
        url: "https://www.pexels.com/video/mist-111/",
        user: { name: "Rowan Ito" },
        video_files: [{ id: 1, file_type: "video/mp4", width: 1920, height: 1080, link: PEXELS_DOWNLOAD }],
      },
      {
        id: 222,
        duration: 12,
        url: "https://www.pexels.com/video/mist-222/",
        user: { name: "Rowan Ito" },
        video_files: [{ id: 1, file_type: "video/mp4", width: 1920, height: 1080, link: PEXELS_DOWNLOAD }],
      },
    ],
  };
}

function pixabaySearchBody(): unknown {
  return {
    hits: [
      {
        id: 77,
        pageURL: "https://pixabay.com/videos/id-77/",
        duration: 9,
        user: "Amara Odell",
        videos: { large: { url: PIXABAY_DOWNLOAD, width: 1920, height: 1080 } },
      },
      {
        id: 78,
        pageURL: "https://pixabay.com/videos/id-78/",
        duration: 12,
        user: "Amara Odell",
        videos: { large: { url: PIXABAY_DOWNLOAD, width: 1920, height: 1080 } },
      },
    ],
  };
}

describe("defaultRunners footage wiring", () => {
  let server: Server;
  let baseURL: string;
  let requests: { path: string; search: URLSearchParams; auth: string | undefined }[];
  let respondWith: () => { status: number; body: string; contentType: string };

  beforeEach(async () => {
    requests = [];
    respondWith = () => ({ status: 200, body: JSON.stringify(pexelsSearchBody()), contentType: "application/json" });
    server = createServer((req, res) => {
      const url = new URL(req.url ?? "", "http://127.0.0.1");
      requests.push({ path: url.pathname, search: url.searchParams, auth: req.headers["authorization"] });
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

  const pexelsEnv = () => ({
    SHORTREELCUTS_FOOTAGE_PROVIDER: "pexels",
    SHORTREELCUTS_FOOTAGE_API_KEY: SECRET_KEY,
    SHORTREELCUTS_FOOTAGE_BASE_URL: baseURL,
  });

  const pixabayEnv = () => ({
    SHORTREELCUTS_FOOTAGE_PROVIDER: "pixabay",
    SHORTREELCUTS_FOOTAGE_API_KEY: SECRET_KEY,
    SHORTREELCUTS_FOOTAGE_BASE_URL: baseURL,
  });

  it("uses the real provider when Pexels is configured, and records the library's asset id", async () => {
    const plan = fixturePlan();
    const result = await defaultRunners({ env: pexelsEnv() }).footage({ plan });

    expect(requests.length).toBe(plan.script.beats.length);
    expect(requests[0]?.path).toBe("/videos/search");
    expect(requests[0]?.search.get("query")).toBe(plan.script.beats[0]?.search);
    expect(requests[0]?.auth).toBe(SECRET_KEY);

    for (const beat of plan.script.beats) {
      const clip = result.patch.footage[beat.id];
      if (clip?.source !== "stock") throw new Error("expected a stock clip");
      expect(clip.provider).toBe("pexels");
      expect(["111", "222"]).toContain(clip.assetId);
      expect(clip.reason).toContain("pexels");
      expect(clip.reason).toContain(beat.search);
    }
  });

  it("uses the real provider when Pixabay is configured, and keeps its key out of everything but the request", async () => {
    respondWith = () => ({ status: 200, body: JSON.stringify(pixabaySearchBody()), contentType: "application/json" });
    const plan = fixturePlan();
    const result = await defaultRunners({ env: pixabayEnv() }).footage({ plan });

    expect(requests[0]?.path).toBe("/videos/");
    expect(requests[0]?.search.get("key")).toBe(SECRET_KEY);
    expect(requests[0]?.search.get("q")).toBe(plan.script.beats[0]?.search);

    for (const beat of plan.script.beats) {
      const clip = result.patch.footage[beat.id];
      if (clip?.source !== "stock") throw new Error("expected a stock clip");
      expect(clip.provider).toBe("pixabay");
      expect(["77", "78"]).toContain(clip.assetId);
    }
    expect(JSON.stringify(result.patch)).not.toContain(SECRET_KEY);
    expect(JSON.stringify(result.candidates)).not.toContain(SECRET_KEY);
  });

  it("stores the library's asset id in the plan and never a media URL or a file", async () => {
    const plan = fixturePlan();
    const result = await defaultRunners({ env: pexelsEnv() }).footage({ plan });

    const serialised = JSON.stringify(result.patch);
    expect(serialised).not.toContain(PEXELS_DOWNLOAD);
    expect(serialised).not.toContain("videos.pexels.com");
    expect(serialised).not.toContain(".mp4");
    for (const clip of Object.values(result.patch.footage)) {
      if (clip.source !== "stock") throw new Error("expected a stock clip");
      // The only identifier that re-points at the media is the asset id,
      // and it is re-resolved at render time rather than stored.
      expect(clip.assetId).toMatch(/^(111|222)$/);
      expect(clip.credit.pageUrl).toContain("www.pexels.com");
    }
  });

  it("falls back to the marked stub, and sends no request, when no footage provider is configured", async () => {
    const runners = defaultRunners({ env: {} });
    // The documented fallback is this stage, not a copy of it.
    expect(runners.footage).toBe(runFootage);

    const result = await runners.footage({ plan: fixturePlan() });

    for (const clip of Object.values(result.patch.footage)) {
      if (clip.source !== "stock") throw new Error("expected a stock clip");
      expect(clip.provider).toBe("stub");
      expect(clip.reason).toContain("stub");
      expect(clip.reason).toContain("no stock library was searched");
    }
    expect(requests).toHaveLength(0);
  });

  it("fails the worker at boot, rather than quietly stubbing, when a library is named without a key", () => {
    expect(() => defaultRunners({ env: { SHORTREELCUTS_FOOTAGE_PROVIDER: "pexels" } })).toThrow(MissingFootageApiKeyError);
  });

  it("fails the worker at boot, rather than guessing, when the named library has no adapter", () => {
    expect(() =>
      defaultRunners({ env: { SHORTREELCUTS_FOOTAGE_PROVIDER: "coverr", SHORTREELCUTS_FOOTAGE_API_KEY: SECRET_KEY } }),
    ).toThrow(UnknownFootageProviderError);
  });

  it("fails the stage loudly on a non-2xx from the library, with no key in the message", async () => {
    respondWith = () => ({ status: 401, body: JSON.stringify({ error: "invalid key" }), contentType: "application/json" });
    const runners = defaultRunners({ env: pexelsEnv() });

    const failure = runners.footage({ plan: fixturePlan() });
    await expect(failure).rejects.toBeInstanceOf(FootageSearchError);
    await expect(failure).rejects.not.toThrow(new RegExp(SECRET_KEY));
  });

  it("fails the stage loudly on an unparseable 2xx, rather than falling back to the stub", async () => {
    respondWith = () => ({ status: 200, body: "<html>maintenance</html>", contentType: "text/html" });
    const runners = defaultRunners({ env: pexelsEnv() });

    await expect(runners.footage({ plan: fixturePlan() })).rejects.toBeInstanceOf(FootageSearchError);
  });

  it("fails the stage loudly when the library returns no clips for the search term", async () => {
    respondWith = () => ({ status: 200, body: JSON.stringify({ videos: [] }), contentType: "application/json" });
    const runners = defaultRunners({ env: pexelsEnv() });

    await expect(runners.footage({ plan: fixturePlan() })).rejects.toBeInstanceOf(FootageSearchError);
  });

  it("never writes the configured footage key to the console while sourcing", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );

    try {
      // Spied across both wiring (connection resolution at construction) and the stage run.
      const runners = defaultRunners({ env: pexelsEnv() });
      await runners.footage({ plan: fixturePlan() });
      for (const spy of spies) {
        for (const call of spy.mock.calls) {
          expect(call.join(" ")).not.toContain(SECRET_KEY);
        }
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it("refuses a library answer whose asset id is a download URL, instead of recording it in a shareable plan", async () => {
    respondWith = () => ({
      status: 200,
      body: JSON.stringify({
        videos: [
          {
            id: PEXELS_DOWNLOAD,
            duration: 9,
            url: "https://www.pexels.com/video/mist-111/",
            user: { name: "Rowan Ito" },
            video_files: [],
          },
        ],
      }),
      contentType: "application/json",
    });
    const runners = defaultRunners({ env: pexelsEnv() });

    await expect(runners.footage({ plan: fixturePlan() })).rejects.toBeInstanceOf(PlanMediaUrlLeakError);
  });

  it("rejects a malformed footage base URL at boot rather than mid-render", () => {
    expect(() =>
      defaultRunners({ env: { ...pexelsEnv(), SHORTREELCUTS_FOOTAGE_BASE_URL: "not-a-url" } }),
    ).toThrow(/absolute http\(s\) URL/);
  });
});
