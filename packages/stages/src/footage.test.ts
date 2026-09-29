import { describe, expect, it } from "vitest";
import { parsePlan, type Plan, type StockFootage } from "@shortreelcuts/plan";
import {
  GeneratedFootageAdapter,
  MotionFootageAdapter,
  PlanMediaUrlLeakError,
  StockFootageAdapter,
  type FootageProvider,
  type StockClipCandidate,
  type StockSearchRequest,
} from "@shortreelcuts/providers";
import { makeSheetFixturePlan } from "./testing/fixtures.js";
import { createFootageRunner, runFootage } from "./footage.js";

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

/** A library that always answers, with a download link sitting in the response that the provider deliberately drops. */
function fakeProvider(
  candidatesFor: (request: StockSearchRequest) => StockClipCandidate[],
  overrides: Partial<FootageProvider> = {},
): FootageProvider & { readonly requests: StockSearchRequest[] } {
  const requests: StockSearchRequest[] = [];
  return {
    id: "pexels",
    planUrlHosts: ["www.pexels.com", "pexels.com"],
    requests,
    async search(request) {
      requests.push(request);
      return candidatesFor(request);
    },
    async resolveMediaUrl(assetId) {
      return `https://videos.pexels.com/video-files/${assetId}/hd.mp4`;
    },
    ...overrides,
  };
}

function candidatesFor(request: StockSearchRequest): StockClipCandidate[] {
  return [1, 2, 3, 4].map((n) => ({
    assetId: `pexels-${request.beatId}-${n}`,
    label: `${request.search} — Pexels clip ${n}`,
    durationSeconds: 6 + n,
    credit: { creator: "Rowan Ito", pageUrl: `https://www.pexels.com/video/clip-${request.beatId}-${n}/` },
  }));
}

describe("createFootageRunner (real provider)", () => {
  it("asks the library for the scene's own search term, count and orientation, and picks one candidate", async () => {
    const provider = fakeProvider(candidatesFor);
    const plan = makeSheetFixturePlan();

    const result = await createFootageRunner(provider)({ plan });

    expect(provider.requests.length).toBe(plan.script.beats.length);
    expect(provider.requests[0]).toMatchObject({
      beatId: plan.script.beats[0]?.id,
      search: plan.script.beats[0]?.search,
      count: 4,
    });
    // 1080×1920 is portrait output, and the library is told so rather than
    // left to return landscape clips for a vertical video.
    expect(provider.requests[0]?.orientation).toBe("portrait");

    for (const beat of plan.script.beats) {
      const candidates = result.candidates[`footage.${beat.id}`];
      expect(candidates).toHaveLength(4);
      expect(candidates?.filter((c) => c.chosen)).toHaveLength(1);
      const clip = result.patch.footage[beat.id];
      if (clip?.source !== "stock") throw new Error("expected a stock clip");
      expect(clip.assetId).toBe(candidates?.find((c) => c.chosen)?.id);
    }
  });

  it("records why, with the provider, the asset, the alternatives and the search term", async () => {
    const plan = makeSheetFixturePlan();
    const result = await createFootageRunner(fakeProvider(candidatesFor))({ plan });

    for (const beat of plan.script.beats) {
      const reason = result.patch.footage[beat.id]?.reason ?? "";
      expect(reason).toContain("pexels");
      expect(reason).toContain(beat.search);
      expect(reason).toContain("closest of 4 clips");
      // The reason says nothing about a stub, because nothing was stubbed.
      expect(reason).not.toContain("stub");
    }
  });

  it("records only the library's asset id — no media URL anywhere in the patch", async () => {
    const plan = makeSheetFixturePlan();
    const result = await createFootageRunner(fakeProvider(candidatesFor))({ plan });

    const serialised = JSON.stringify(result.patch);
    expect(serialised).not.toContain("videos.pexels.com");
    expect(serialised).not.toContain(".mp4");
    for (const beat of plan.script.beats) {
      const clip = result.patch.footage[beat.id];
      if (clip?.source !== "stock") throw new Error("expected a stock clip");
      expect(clip.assetId).toMatch(/^pexels-/);
      expect(clip.credit.pageUrl).toContain("www.pexels.com");
    }
  });

  it("trims to the scene's length without asking for more clip than the library holds", async () => {
    const provider = fakeProvider((request) => candidatesFor(request).map((c) => ({ ...c, durationSeconds: 1.5 })));
    const result = await createFootageRunner(provider)({ plan: makeSheetFixturePlan() });

    for (const clip of Object.values(result.patch.footage)) {
      expect(clip.source).toBe("stock");
      if (clip.source !== "stock") throw new Error("expected a stock clip");
      expect(clip.in).toBe(0);
      expect(clip.out).toBeCloseTo(1.5);
    }
  });

  it("produces a plan that validates against the schema", async () => {
    const plan = makeSheetFixturePlan();
    const result = await createFootageRunner(fakeProvider(candidatesFor))({ plan });

    expect(() =>
      parsePlan({ ...plan, footage: result.patch.footage, align: { ...plan.align, words: {} } }),
    ).not.toThrow();
  });

  it("is deterministic given the same plan and the same library answer", async () => {
    const plan = makeSheetFixturePlan();
    const a = await createFootageRunner(fakeProvider(candidatesFor))({ plan });
    const b = await createFootageRunner(fakeProvider(candidatesFor))({ plan });
    expect(a.patch).toEqual(b.patch);
  });

  it("fails loudly rather than falling back to the stub when the library errors", async () => {
    const runner = createFootageRunner(
      fakeProvider(() => {
        throw new Error("503 from the library");
      }),
    );

    await expect(runner({ plan: makeSheetFixturePlan() })).rejects.toThrow(/rather than falling back to the deterministic stub/);
  });

  it("fails loudly rather than inventing a clip when the library returns nothing", async () => {
    const runner = createFootageRunner(fakeProvider(() => []));

    await expect(runner({ plan: makeSheetFixturePlan() })).rejects.toThrow(/returned nothing usable/);
  });

  it("refuses a candidate whose asset id is a media URL — the sabotage this rule exists to catch", async () => {
    const runner = createFootageRunner(
      fakeProvider((request) =>
        candidatesFor(request).map((c) => ({
          ...c,
          assetId: "https://videos.pexels.com/video-files/1/hd_1920_1080.mp4",
        })),
      ),
    );

    await expect(runner({ plan: makeSheetFixturePlan() })).rejects.toBeInstanceOf(PlanMediaUrlLeakError);
  });

  it("refuses a candidate whose credit page sits on the library's media CDN", async () => {
    const runner = createFootageRunner(
      fakeProvider((request) =>
        candidatesFor(request).map((c) => ({
          ...c,
          credit: { creator: c.credit.creator, pageUrl: "https://videos.pexels.com/video-files/1/hd.mp4" },
        })),
      ),
    );

    await expect(runner({ plan: makeSheetFixturePlan() })).rejects.toBeInstanceOf(PlanMediaUrlLeakError);
  });

  /**
   * Poisons one candidate of the first beat that the seed provably does
   * *not* choose, and returns the runner. Choosing a known loser is the
   * whole point: a leak caught by the clip assertion would make these tests
   * pass without ever proving the candidate-wide guard exists.
   */
  async function runnerWithPoisonedLoser(poison: (candidate: StockClipCandidate) => StockClipCandidate): Promise<{
    readonly plan: Plan;
    readonly runner: ReturnType<typeof createFootageRunner>;
  }> {
    const plan = makeSheetFixturePlan();
    const firstBeat = plan.script.beats[0];
    if (!firstBeat) throw new Error("the fixture plan has no beats");

    const clean = await createFootageRunner(fakeProvider(candidatesFor))({ plan });
    const chosenId = clean.candidates[`footage.${firstBeat.id}`]?.find((c) => c.chosen)?.id;
    const candidates = candidatesFor({
      beatId: firstBeat.id,
      search: firstBeat.search,
      count: 4,
      targetSeconds: 4,
      orientation: "portrait",
    });
    const loserIndex = candidates.findIndex((c) => c.assetId !== chosenId);
    expect(loserIndex).toBeGreaterThanOrEqual(0);

    return {
      plan,
      runner: createFootageRunner(
        fakeProvider((request) =>
          request.beatId === firstBeat.id
            ? candidates.map((c, index) => (index === loserIndex ? poison(c) : c))
            : candidatesFor(request),
        ),
      ),
    };
  }

  it("refuses a download URL as the asset id of a candidate the seed did not choose, not only in the winner", async () => {
    const { plan, runner } = await runnerWithPoisonedLoser((c) => ({
      ...c,
      assetId: "https://videos.pexels.com/video-files/9/hd_1920_1080.mp4",
    }));

    await expect(runner({ plan })).rejects.toBeInstanceOf(PlanMediaUrlLeakError);
  });

  it("refuses a download URL embedded in a losing candidate's free-text label", async () => {
    const { plan, runner } = await runnerWithPoisonedLoser((c) => ({
      ...c,
      label: "a climb (https://videos.pexels.com/video-files/9/hd.mp4)",
    }));

    await expect(runner({ plan })).rejects.toBeInstanceOf(PlanMediaUrlLeakError);
  });

  it("stores no media URL anywhere in the recorded candidates, not only in the chosen clip", async () => {
    const plan = makeSheetFixturePlan();
    const result = await createFootageRunner(fakeProvider(candidatesFor))({ plan });

    const serialised = JSON.stringify(result.candidates);
    expect(serialised).not.toContain("videos.pexels.com");
    expect(serialised).not.toContain(".mp4");
  });
});

describe("runFootage (stub) honesty", () => {
  it("says in the plan that no stock library was searched, and that the asset id is synthetic", async () => {
    const plan = makeSheetFixturePlan();
    const result = await runFootage({ plan });

    for (const beat of plan.script.beats) {
      const clip = result.patch.footage[beat.id];
      if (clip?.source !== "stock") throw new Error("expected a stock clip");
      expect(clip.provider).toBe("stub");
      expect(clip.reason).toContain("stub");
      expect(clip.reason).toContain("no stock library was searched");
      expect(clip.reason).toContain("will not resolve to a real clip");
    }
  });
});

describe("StockFootageSchema compatibility of a real clip", () => {
  it("round-trips a clip the stage built through the plan's own schema", async () => {
    const plan = makeSheetFixturePlan();
    const result = await createFootageRunner(fakeProvider(candidatesFor))({ plan });
    const clip = result.patch.footage[plan.script.beats[0]?.id ?? "b1"] as StockFootage;
    expect(() => parsePlan({ ...plan, footage: { [plan.script.beats[0]?.id ?? "b1"]: clip }, align: { ...plan.align, words: {} } })).not.toThrow();
  });
});

