import { describe, expect, it } from "vitest";
import { estimateRerun, STAGE_COST } from "./cost.js";

describe("estimateRerun", () => {
  it("returns a zero-cost, no-op estimate for an empty stage set", () => {
    const estimate = estimateRerun([]);
    expect(estimate.stages).toEqual([]);
    expect(estimate.totalSeconds).toBe(0);
    expect(estimate.headline).toBe("Nothing to re-run");
  });

  it("phrases a single compose-only re-run as the card's own example", () => {
    const estimate = estimateRerun(["compose"]);
    expect(estimate.headline).toMatch(/^Re-renders in about \d+ seconds$/);
    expect(estimate.path).toBe("compose");
  });

  it("phrases a voice → align → compose re-run as the card's own example", () => {
    const estimate = estimateRerun(["voice", "align", "compose"]);
    expect(estimate.headline).toMatch(/^Regenerates the voiceover — about \d+ seconds$/);
    expect(estimate.path).toBe("voice → align → compose");
  });

  it("total is the sum of every declared stage cost", () => {
    const raw = STAGE_COST.voice.seconds + STAGE_COST.align.seconds + STAGE_COST.compose.seconds;
    const estimate = estimateRerun(["voice", "align", "compose"]);
    // rounded to the nearest 5 seconds — see estimateRerun's rounding rule
    expect(Math.abs(estimate.totalSeconds - raw)).toBeLessThanOrEqual(3);
  });

  it("a full re-run costs at least as much as any of its subsets", () => {
    const partial = estimateRerun(["compose"]).totalSeconds;
    const full = estimateRerun(["script", "voice", "footage", "align", "compose"]).totalSeconds;
    expect(full).toBeGreaterThan(partial);
  });
});
