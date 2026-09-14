import { describe, expect, it } from "vitest";
import { makeSheetFixturePlan } from "./testing/fixtures.js";
import { runAlign } from "./align.js";

describe("runAlign (stub)", () => {
  it("times every word of every beat's narration, in order, with no gaps or overlaps", async () => {
    const plan = makeSheetFixturePlan();
    const result = await runAlign({ plan });

    for (const beat of plan.script.beats) {
      const words = result.patch.align.words[beat.id];
      const expectedWords = beat.narration.split(/\s+/).filter(Boolean);
      expect(words?.map((w) => w.word)).toEqual(expectedWords);
      words?.forEach((w, i) => {
        expect(w.endSeconds).toBeGreaterThan(w.startSeconds);
        const prev = words[i - 1];
        if (prev) expect(w.startSeconds).toBe(prev.endSeconds);
      });
    }
  });

  it("times faster at a higher voice rate", async () => {
    const slow = makeSheetFixturePlan({ voice: { provider: "stub", voiceId: "warm-female", rate: 1.0, reason: "r" } });
    const fast = makeSheetFixturePlan({ voice: { provider: "stub", voiceId: "warm-female", rate: 2.0, reason: "r" } });
    const slowResult = await runAlign({ plan: slow });
    const fastResult = await runAlign({ plan: fast });
    const slowWord = slowResult.patch.align.words["b1"]?.[0];
    const fastWord = fastResult.patch.align.words["b1"]?.[0];
    expect(fastWord?.endSeconds).toBeLessThan(slowWord?.endSeconds ?? Infinity);
  });

  it("has no candidates to show — alignment measures, it does not choose", async () => {
    const result = await runAlign({ plan: makeSheetFixturePlan() });
    expect(Object.keys(result.candidates)).toHaveLength(0);
  });
});
