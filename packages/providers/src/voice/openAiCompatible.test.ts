/**
 * Proves the request/response plumbing against a controlled local HTTP
 * server standing in for "a TTS API" — reliable and fast, unlike a real
 * speech model. `openAiCompatible.e2e.test.ts` exercises the local path
 * against a real, already-running TTS server separately, when one exists.
 *
 * The audio here is a real WAV, built byte by byte in this file, so the
 * provider's duration measurement and its "malformed response" path are
 * both checked against actual bytes rather than a mock of them.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaSink, NarrationLine, VoiceChoice, VoiceConnection } from "../types.js";
import {
  createOpenAiCompatibleVoiceProvider,
  VoiceProviderParseError,
  VoiceProviderRequestError,
} from "./openAiCompatible.js";

const LINES: readonly NarrationLine[] = [
  { id: "b1", text: "The ocean is salty because rain erodes rock." },
  { id: "b2", text: "Rivers carry those minerals to the sea." },
];
const CHOICE: VoiceChoice = { voiceId: "test-voice", rate: 1.0 };
// Deliberately not shaped like a real provider key prefix (this repository's own CI scans for
// those, correctly) — a fake, obviously-a-test credential is enough to prove the leak check.
const SECRET_KEY = "TEST-FAKE-CREDENTIAL-DO-NOT-LEAK-4f9c2";
const VOICE_IDS = ["test-voice", "other-voice"];

/** A minimal, valid 16-bit mono PCM WAV holding `seconds` of silence. */
function wavBytes(seconds: number, sampleRate = 8000): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = Math.round(byteRate * seconds);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const tag = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  tag(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  tag(36, "data");
  view.setUint32(40, dataSize, true);
  return new Uint8Array(buffer);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function connection(baseURL: string, apiKey?: string): VoiceConnection {
  return apiKey
    ? { kind: "byok", baseURL, model: "tts-test", apiKey, voiceIds: VOICE_IDS }
    : { kind: "local", baseURL, model: "tts-test", voiceIds: VOICE_IDS };
}

describe("createOpenAiCompatibleVoiceProvider", () => {
  let server: Server;
  let baseURL: string;
  let lastAuthHeader: string | undefined;
  let lastPath: string | undefined;
  let bodies: string[];
  let respondWith: () => { status: number; body: Buffer | string; contentType: string };

  const makeSink = (): { sink: MediaSink; stored: { bytes: Uint8Array; contentType: string }[] } => {
    const stored: { bytes: Uint8Array; contentType: string }[] = [];
    const sink: MediaSink = {
      async put(bytes, contentType) {
        stored.push({ bytes, contentType });
        return `sha256:test-${stored.length}`;
      },
    };
    return { sink, stored };
  };

  beforeEach(async () => {
    respondWith = () => ({ status: 200, body: Buffer.from(wavBytes(1.5)), contentType: "audio/wav" });
    server = createServer(async (req, res) => {
      lastAuthHeader = req.headers["authorization"];
      lastPath = req.url;
      bodies.push(await readBody(req));
      const { status, body, contentType } = respondWith();
      res.writeHead(status, { "content-type": contentType });
      res.end(body);
    });
    bodies = [];
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("expected an AddressInfo");
    baseURL = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("connects to a correctly-shaped TTS endpoint and returns one stored audio track per line", async () => {
    const { sink, stored } = makeSink();
    const provider = createOpenAiCompatibleVoiceProvider(connection(baseURL, SECRET_KEY), sink);

    expect(provider.id).toBe("openai-compatible:byok");
    const tracks = await provider.speak(LINES, CHOICE);

    expect(lastAuthHeader).toBe(`Bearer ${SECRET_KEY}`);
    expect(lastPath).toBe("/audio/speech");
    expect(JSON.parse(bodies[0] ?? "{}")).toMatchObject({
      model: "tts-test",
      input: LINES[0]?.text,
      voice: "test-voice",
      response_format: "wav",
      speed: 1.0,
    });
    expect(JSON.parse(bodies[1] ?? "{}")).toMatchObject({ input: LINES[1]?.text });
    expect(tracks).toEqual([
      { lineId: "b1", mediaKey: "sha256:test-1", durationSeconds: 1.5 },
      { lineId: "b2", mediaKey: "sha256:test-2", durationSeconds: 1.5 },
    ]);
    expect(stored).toHaveLength(2);
    expect(stored[0]?.contentType).toBe("audio/wav");
    expect(stored[0]?.bytes.length).toBeGreaterThan(44);
  });

  it("sends no Authorization header for a local connection", async () => {
    const { sink } = makeSink();
    const provider = createOpenAiCompatibleVoiceProvider(connection(baseURL), sink);
    lastAuthHeader = "unset";

    await provider.speak(LINES, CHOICE);

    expect(lastAuthHeader).toBeUndefined();
  });

  it("declares the endpoint's configured voices as its capability list", async () => {
    const { sink } = makeSink();
    const provider = createOpenAiCompatibleVoiceProvider(connection(baseURL), sink);

    await expect(provider.voices()).resolves.toEqual([
      { id: "test-voice", label: "test-voice" },
      { id: "other-voice", label: "other-voice" },
    ]);
  });

  it("throws VoiceProviderRequestError on a non-2xx response, with no credential in the message", async () => {
    respondWith = () => ({ status: 401, body: JSON.stringify({ error: "unauthorized" }), contentType: "application/json" });
    const { sink } = makeSink();
    const provider = createOpenAiCompatibleVoiceProvider(connection(baseURL, SECRET_KEY), sink);

    await expect(provider.speak([LINES[0] as NarrationLine], CHOICE)).rejects.toBeInstanceOf(VoiceProviderRequestError);
    await expect(provider.speak([LINES[0] as NarrationLine], CHOICE)).rejects.not.toThrow(new RegExp(SECRET_KEY));
  });

  it("throws VoiceProviderParseError, not a silently-wrong track, when the response isn't audio", async () => {
    respondWith = () => ({ status: 200, body: JSON.stringify({ error: "no such voice" }), contentType: "application/json" });
    const { sink } = makeSink();
    const provider = createOpenAiCompatibleVoiceProvider(connection(baseURL), sink);

    const failure = provider.speak([LINES[0] as NarrationLine], CHOICE);
    await expect(failure).rejects.toBeInstanceOf(VoiceProviderParseError);
    await expect(failure).rejects.toMatchObject({ rawContent: JSON.stringify({ error: "no such voice" }) });
  });

  it("never lets the API key appear in returned tracks, the stored bytes, the request body, or any console output", async () => {
    const { sink, stored } = makeSink();
    const provider = createOpenAiCompatibleVoiceProvider(connection(baseURL, SECRET_KEY), sink);
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );

    try {
      const tracks = await provider.speak(LINES, CHOICE);

      expect(JSON.stringify(tracks)).not.toContain(SECRET_KEY);
      for (const body of bodies) expect(body).not.toContain(SECRET_KEY);
      expect(lastPath ?? "").not.toContain(SECRET_KEY);
      for (const item of stored) {
        expect(new TextDecoder().decode(item.bytes)).not.toContain(SECRET_KEY);
      }
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
