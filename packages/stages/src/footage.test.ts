import { describe, expect, it } from "vitest";
import { parsePlan } from "@shortreelcuts/plan";
import {
  GeneratedFootageAdapter,
  MotionFootageAdapter,
  StockFootageAdapter,
} from "@shortreelcuts/providers";
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
      const clip = result.patch.footage[beat.id];
      expect(clip?.source).toBe("stock");
      if (clip?.source !== "stock") throw new Error("expected the stub to produce a stock clip");
      expect(clip.assetId).toBe(candidates?.find((c) => c.chosen)?.id);
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

  it("a plan with mixed footage types validates against the schema and produces per-scene footage resolved through the one shared adapter interface", async () => {
    const stockAdapter = new StockFootageAdapter({ id: "pexels" });
    const generatedAdapter = new GeneratedFootageAdapter({ model: "veo-3.1" });
    const motionAdapter = new MotionFootageAdapter({ model: "connected-model" });

    const basePlan = makeSheetFixturePlan();
    const planWithThreeBeats = {
      ...basePlan,
      script: {
        ...basePlan.script,
        beats: [
          { id: "b1", narration: "Stock beat about nature.", onScreen: "Nature", search: "forest canopy" },
          { id: "b2", narration: "Generated beat about space.", onScreen: "Space", search: "mars outpost" },
          { id: "b3", narration: "Motion graphics code beat.", onScreen: "Data", search: "animated metrics" },
        ],
      },
    };

    const result = await runFootage({
      plan: planWithThreeBeats,
      adapters: {
        stock: stockAdapter,
        generated: generatedAdapter,
        motion: motionAdapter,
      },
      sourceByBeat: {
        b1: "stock",
        b2: "generated",
        b3: "motion",
      },
    });

    const fullPlan = parsePlan({
      ...planWithThreeBeats,
      footage: result.patch.footage,
      align: {
        ...planWithThreeBeats.align,
        words: {
          b1: [{ word: "Stock", startSeconds: 0, endSeconds: 2 }],
          b2: [{ word: "Space", startSeconds: 0, endSeconds: 2 }],
          b3: [{ word: "Data", startSeconds: 0, endSeconds: 2 }],
        },
      },
    });

    // 1. Schema validates the mixed plan
    expect(fullPlan).toBeDefined();

    // 2. Each beat's footage is resolved through its corresponding adapter
    const b1 = fullPlan.footage["b1"]!;
    const b2 = fullPlan.footage["b2"]!;
    const b3 = fullPlan.footage["b3"]!;

    expect(b1.source).toBe("stock");
    if (b1.source === "stock") {
      expect(b1.provider).toBe("pexels");
      expect(b1.credit.pageUrl).toContain("pexels.com");
    }

    expect(b2.source).toBe("generated");
    if (b2.source === "generated") {
      expect(b2.model).toBe("veo-3.1");
      expect(b2.output?.mediaKey).toMatch(/^sha256:[a-f0-9]{64}$/);
    }

    expect(b3.source).toBe("motion");
    if (b3.source === "motion") {
      expect(b3.runtime).toBe("srcuts-motion@1");
      expect(b3.scene.kind).toBe("code");
      expect(b3.model).toBe("connected-model");
    }

    // 3. Candidates were weighed and choices recorded with reasons
    for (const beatId of ["b1", "b2", "b3"]) {
      const candidates = result.candidates[`footage.${beatId}`];
      expect(candidates).toBeDefined();
      expect(candidates?.length).toBeGreaterThan(0);
      expect(candidates?.some((c) => c.chosen)).toBe(true);
      expect(fullPlan.footage[beatId]?.reason).toBeTruthy();
    }
  });
});

