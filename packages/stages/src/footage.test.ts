import { describe, expect, it } from "vitest";
import { makeSheetFixturePlan } from "./testing/fixtures.js";
import { runFootage } from "./footage.js";

describe("runFootage (stub)", () => {
  it("proposes several candidates per beat and picks exactly one", async () => {
    const plan = makeSheetFixturePlan();
    const result = await runFootage({ plan });

    for (const beat of plan.script.beats) {
      const candidates = result.candidates[`footage.${beat.id}`];
      expect(candidates?.length).toBeGreaterThan(1);
      expect(candidates?.filter((c) => c.chosen)).toHaveLength(1);
      expect(result.patch.footage[beat.id]?.assetId).toBe(candidates?.find((c) => c.chosen)?.id);
    }
  });

  it("is deterministic given the same plan", async () => {
    const plan = makeSheetFixturePlan();
    const a = await runFootage({ plan });
    const b = await runFootage({ plan });
    expect(a.patch).toEqual(b.patch);
  });

  it("records a per-beat reason mentioning the search term", async () => {
    const plan = makeSheetFixturePlan();
    const result = await runFootage({ plan });
    for (const beat of plan.script.beats) {
      expect(result.patch.footage[beat.id]?.reason).toContain(beat.search);
    }
  });
});
