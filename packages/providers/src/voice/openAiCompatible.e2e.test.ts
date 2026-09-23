/**
 * Runs the local voice path against a real, already-installed and
 * already-running TTS server — no mock server, no download. `docs/SPEC.md`
 * §5.1 promises a local model is a first-class connection for voice as well
 * as script; this is that promise checked against an actual local server
 * rather than only a fake HTTP server standing in for one.
 *
 * Opt in with `SHORTREELCUTS_LOCAL_TTS_E2E=1`. Skipped otherwise — this
 * needs a local OpenAI-audio-speech-compatible TTS server the self-hoster
 * already runs, which the machines running `npm test` will not have.
 * `SHORTREELCUTS_LOCAL_TTS_BASE_URL`, `_NAME` and `_VOICE` point at a
 * different server, model or voice than the defaults below.
 *
 * No real local TTS server was available in the environment this provider
 * was written in, so this test has never been run — it is opt-in and
 * skipped in the default suite. Stated here rather than implied, because a
 * test that passed is evidence and a test that exists is not.
 */
import { describe, expect, it } from "vitest";
import type { MediaSink } from "../types.js";
import { createOpenAiCompatibleVoiceProvider } from "./openAiCompatible.js";

const RUN_E2E = process.env["SHORTREELCUTS_LOCAL_TTS_E2E"] === "1";
const BASE_URL = process.env["SHORTREELCUTS_LOCAL_TTS_BASE_URL"] ?? "http://127.0.0.1:5002";
const MODEL = process.env["SHORTREELCUTS_LOCAL_TTS_NAME"] ?? "local-tts";
const VOICE = process.env["SHORTREELCUTS_LOCAL_TTS_VOICE"] ?? "en_US-lessac-medium";

describe.skipIf(!RUN_E2E)("createOpenAiCompatibleVoiceProvider against a real local TTS server", () => {
  it("reaches the local server with no credential and stores real audio for the line", async () => {
    const stored: number[] = [];
    const sink: MediaSink = {
      async put(bytes) {
        stored.push(bytes.length);
        return `sha256:e2e-${stored.length}`;
      },
    };
    const provider = createOpenAiCompatibleVoiceProvider({ kind: "local", baseURL: BASE_URL, model: MODEL, voiceIds: [VOICE] }, sink);

    const tracks = await provider.speak([{ id: "b1", text: "This is a local text to speech check." }], {
      voiceId: VOICE,
      rate: 1.0,
    });

    expect(tracks).toHaveLength(1);
    expect(tracks[0]?.durationSeconds).toBeGreaterThan(0);
    expect(stored[0]).toBeGreaterThan(44);
  }, 60_000);
});
