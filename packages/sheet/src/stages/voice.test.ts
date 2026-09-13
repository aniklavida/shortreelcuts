import { describe, expect, it } from "vitest";
import { makeSheetFixturePlan } from "../testing/fixtures.js";
import { runVoice, STUB_VOICES } from "./voice.js";

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
});
