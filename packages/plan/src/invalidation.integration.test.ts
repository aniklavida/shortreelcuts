/**
 * The central test for this package: every other test here feeds
 * invalidate() hand-written path strings, which proves the rules but not
 * that they add up to the product's promise. This one starts where a real
 * caller starts — a fully-decided plan and a realistic edit to it — and
 * requires invalidate() to return exactly the stages the re-run table in
 * `docs/SPEC.md` §6 says it should, no more and no less.
 *
 * Each case below edits a full Plan object the way a user's override would
 * (through the decision sheet or the plan editor), diffs it against the
 * original with the same diffPaths() a real caller would use, and asserts
 * the exact stage list invalidate() returns.
 */
import { describe, expect, it } from "vitest";
import { diffPaths, invalidate, invalidateScoped, STAGES, type Stage } from "./index.js";
import type { Plan, StockFootage } from "./schema.js";
import { makeFixturePlan } from "./testing/fixtures.js";

function invalidatedBy(before: Plan, after: Plan): Stage[] {
  return invalidate(diffPaths(before, after));
}

function scopedInvalidatedBy(before: Plan, after: Plan) {
  return invalidateScoped(diffPaths(before, after), after);
}

describe("real plan edits, matched against the invalidation table", () => {
  const original = makeFixturePlan();

  it("re-rendering the identical plan invalidates nothing", () => {
    const identical = makeFixturePlan();
    expect(invalidatedBy(original, identical)).toEqual([]);
  });

  it("caption colour/size/position -> compose only", () => {
    const edited: Plan = { ...original, captions: { ...original.captions, style: "thin-yellow" } };
    expect(invalidatedBy(original, edited)).toEqual(["compose"]);
  });

  it("swap one clip -> frames, then compose", () => {
    const edited: Plan = {
      ...original,
      footage: {
        ...original.footage,
        b2: { ...(original.footage["b2"] as StockFootage), assetId: "clip-hands-alternate-candidate" },
      },
    };
    expect(invalidatedBy(original, edited)).toEqual(["frames", "compose"]);
    // Per-beat: only b2's frames output actually needs to change.
    const scoped = scopedInvalidatedBy(original, edited);
    expect(scoped.find((s) => s.stage === "frames")?.beats).toEqual(new Set(["b2"]));
  });

  it("crop or trim a clip -> frames, then compose", () => {
    const edited: Plan = {
      ...original,
      footage: { ...original.footage, b1: { ...(original.footage["b1"] as StockFootage), in: 0.5, out: 3.9 } },
    };
    expect(invalidatedBy(original, edited)).toEqual(["frames", "compose"]);
  });

  it("search term for one beat -> footage, frames, then compose", () => {
    const edited: Plan = {
      ...original,
      script: {
        ...original.script,
        beats: [
          original.script.beats[0]!,
          { ...original.script.beats[1]!, search: "tea processing factory workers" },
        ],
      },
    };
    expect(invalidatedBy(original, edited)).toEqual(["footage", "frames", "compose"]);
  });

  it("voice, or speaking rate -> voice, align, frames, compose", () => {
    const edited: Plan = { ...original, voice: { ...original.voice, rate: 0.9 } };
    expect(invalidatedBy(original, edited)).toEqual(["voice", "align", "frames", "compose"]);
    // Per-beat: this fixture has no motion beats, so frames is invalidated for zero beats,
    // not "all" — the whole point of scoping invalidation by beat.
    const scoped = scopedInvalidatedBy(original, edited);
    expect(scoped.find((s) => s.stage === "frames")?.beats).toEqual(new Set());
  });

  it("any script line -> voice, align, frames, compose (footage untouched: the search term did not move)", () => {
    const edited: Plan = {
      ...original,
      script: {
        ...original.script,
        beats: [
          { ...original.script.beats[0]!, narration: "It begins high in the hills near Sylhet." },
          original.script.beats[1]!,
        ],
      },
    };
    const result = invalidatedBy(original, edited);
    expect(result).toEqual(["voice", "align", "frames", "compose"]);
    expect(result).not.toContain("footage");
  });

  it("a script line plus its own search term moving -> voice, footage, align, frames, compose", () => {
    const edited: Plan = {
      ...original,
      script: {
        ...original.script,
        beats: [
          {
            ...original.script.beats[0]!,
            narration: "It begins high in the hills near Sylhet.",
            search: "hillside tea plantation sylhet",
          },
          original.script.beats[1]!,
        ],
      },
    };
    expect(invalidatedBy(original, edited)).toEqual(["voice", "footage", "align", "frames", "compose"]);
  });

  it("the prompt itself -> everything", () => {
    const edited: Plan = { ...original, brief: { ...original.brief, prompt: "a video about coffee instead" } };
    expect(invalidatedBy(original, edited)).toEqual(STAGES);
  });

  it("a fresh seed with the same brief -> everything", () => {
    const edited: Plan = { ...original, seed: original.seed + 1 };
    expect(invalidatedBy(original, edited)).toEqual(STAGES);
  });

  it("editing only a recorded reason -> nothing, even though the plan text changed", () => {
    const edited: Plan = {
      ...original,
      footage: {
        ...original.footage,
        b1: { ...original.footage["b1"]!, reason: "a completely rewritten explanation" },
      },
    };
    expect(invalidatedBy(original, edited)).toEqual([]);
  });
});

describe("real plan edits, per-beat scoping against a mixed-source plan (docs/SPEC.md §6)", () => {
  // b1 is motion, b2 is stock — a real mix of two of the three sources docs/SPEC.md §11 names.
  const original: Plan = {
    ...makeFixturePlan(),
    footage: {
      ...makeFixturePlan().footage,
      b1: {
        source: "motion",
        runtime: "srcuts-motion@1",
        scene: { kind: "template", template: "kinetic-headline", params: { headline: "Cha, explained." } },
        captionsInScene: true,
        model: "a connected model",
        reason: "the opening claim is text, better animated than shown as stock footage",
      },
    },
  };

  it("editing the motion beat's template params invalidates frames for that beat only", () => {
    const edited: Plan = {
      ...original,
      footage: {
        ...original.footage,
        b1: {
          ...(original.footage["b1"] as Extract<Plan["footage"][string], { source: "motion" }>),
          scene: { kind: "template", template: "kinetic-headline", params: { headline: "Cha, really explained." } },
        },
      },
    };
    const scoped = invalidateScoped(diffPaths(original, edited), edited);
    expect(scoped.find((s) => s.stage === "frames")?.beats).toEqual(new Set(["b1"]));
    expect(scoped.find((s) => s.stage === "compose")?.beats).toBe("all");
    expect(invalidatedBy(original, edited)).toEqual(["frames", "compose"]);
  });

  it("changing the voice invalidates frames for the motion beat and not the stock beat", () => {
    const edited: Plan = { ...original, voice: { ...original.voice, rate: 1.15 } };
    const scoped = invalidateScoped(diffPaths(original, edited), edited);
    expect(scoped.find((s) => s.stage === "frames")?.beats).toEqual(new Set(["b1"]));
  });
});
