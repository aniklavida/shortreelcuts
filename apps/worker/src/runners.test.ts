/**
 * Proves the script wiring in `defaultRunners`: a configured model
 * connection drives the real provider, no connection gets the explicitly
 * marked stub, a parse failure fails loudly instead of falling back, and
 * the configured key reaches neither the plan nor the logs.
 *
 * The model is a controlled local HTTP server standing in for any
 * OpenAI-chat-completions endpoint — the same technique
 * `openAiCompatible.test.ts` uses, and the same one that makes a hosted
 * BYOK key and a local runtime one request shape (`docs/SPEC.md` §5.1).
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Brief, Plan } from "@shortreelcuts/plan";
import { createVoiceRunner, ScriptGenerationError, VoiceGenerationError } from "@shortreelcuts/stages";
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
