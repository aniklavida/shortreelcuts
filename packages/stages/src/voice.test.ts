import { describe, expect, it } from "vitest";
import { makeSheetFixturePlan } from "./testing/fixtures.js";
import { createVoiceRunner, runVoice, STUB_VOICES, VoiceGenerationError } from "./voice.js";

describe("runVoice (stub)", () => {
  it("proposes every catalogued voice as a candidate and picks exactly one", async () => {
    const plan = makeSheetFixturePlan();
    const result = await runVoice({ plan });
    const candidates = result.candidates["voice.voiceId"];
    expect(candidates).toHaveLength(STUB_VOICES.length);
    expect(candidates?.filter((c) => c.chosen)).toHaveLength(1);
  });

  it("prefers a voice whose declared tones include the brief's tone", async () => {
    const plan = makeSheetFixturePlan({ brief: { prompt: "x", targetSeconds: 20, tone: "energetic" } });
    const result = await runVoice({ plan });
    expect(result.patch.voice.voiceId).toBe("confident-male");
  });

  it("is deterministic given the same plan", async () => {
    const plan = makeSheetFixturePlan();
    const a = await runVoice({ plan });
    const b = await runVoice({ plan });
    expect(a.patch).toEqual(b.patch);
  });

  it("records a non-empty reason", async () => {
    const result = await runVoice({ plan: makeSheetFixturePlan() });
    expect(result.patch.voice.reason.length).toBeGreaterThan(0);
  });

  it("marks its output as a deterministic stub, never a real generation", async () => {
    const result = await runVoice({ plan: makeSheetFixturePlan() });
    expect(result.patch.voice.reason.toLowerCase()).toContain("stub");
    expect(result.patch.voice.reason).toContain("no speech engine was called");
  });
});

describe("createVoiceRunner", () => {
  const mockProvider = (voices: { id: string; label: string }[]) => ({
    id: "test-voice-provider",
    voices: async () => voices,
    speak: async () => [],
  });

  it("proposes all declared voices as candidates and picks deterministically", async () => {
    const provider = mockProvider([
      { id: "v1", label: "Voice 1" },
      { id: "v2", label: "Voice 2" },
    ]);
    const runner = createVoiceRunner(provider);
    const plan = makeSheetFixturePlan();

    const result = await runner({ plan });

    expect(result.patch.voice.provider).toBe("test-voice-provider");
    expect(["v1", "v2"]).toContain(result.patch.voice.voiceId);
    expect(result.patch.voice.reason).toContain("test-voice-provider");

    const candidates = result.candidates["voice.voiceId"];
    expect(candidates).toHaveLength(2);
    expect(candidates?.filter((c) => c.chosen)).toHaveLength(1);
    expect(candidates?.find((c) => c.chosen)?.id).toBe(result.patch.voice.voiceId);
  });

  it("fails loudly with VoiceGenerationError when the provider throws", async () => {
    const provider = {
      id: "broken-provider",
      voices: async () => {
        throw new Error("network timeout");
      },
      speak: async () => [],
    };
    const runner = createVoiceRunner(provider);
    const plan = makeSheetFixturePlan();

    await expect(runner({ plan })).rejects.toThrow(VoiceGenerationError);
  });

  it("fails loudly with VoiceGenerationError when the provider declares no voices", async () => {
    const provider = mockProvider([]);
    const runner = createVoiceRunner(provider);
    const plan = makeSheetFixturePlan();

    await expect(runner({ plan })).rejects.toThrow(VoiceGenerationError);
  });
});
