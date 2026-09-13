/**
 * The flagship test for this card: given a real, fully-decided plan and a
 * realistic edit to it — not a hand-written path string — invalidate()
 * must return exactly the stages the product's invalidation table says it
 * should, no more and no less.
 *
 * Each case below edits a full Plan object the way a user's override would
 * (through the decision sheet or the plan editor), diffs it against the
 * original with the same diffPaths() a real caller would use, and asserts
 * the exact stage list invalidate() returns.
 */
import { describe, expect, it } from "vitest";
import { diffPaths, invalidate, STAGES, type Stage } from "./index.js";
import type { Plan } from "./schema.js";
import { makeFixturePlan } from "./testing/fixtures.js";

function invalidatedBy(before: Plan, after: Plan): Stage[] {
  return invalidate(diffPaths(before, after));
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

  it("swap one clip -> compose only", () => {
    const edited: Plan = {
      ...original,
      footage: {
        ...original.footage,
        b2: { ...original.footage["b2"]!, assetId: "clip-hands-alternate-candidate" },
      },
    };
    expect(invalidatedBy(original, edited)).toEqual(["compose"]);
  });

  it("crop or trim a clip -> compose only", () => {
    const edited: Plan = {
      ...original,
      footage: { ...original.footage, b1: { ...original.footage["b1"]!, in: 0.5, out: 3.9 } },
    };
    expect(invalidatedBy(original, edited)).toEqual(["compose"]);
  });

  it("search term for one beat -> footage, then compose", () => {
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
    expect(invalidatedBy(original, edited)).toEqual(["footage", "compose"]);
  });

  it("voice, or speaking rate -> voice, align, compose", () => {
    const edited: Plan = { ...original, voice: { ...original.voice, rate: 0.9 } };
    expect(invalidatedBy(original, edited)).toEqual(["voice", "align", "compose"]);
  });

  it("any script line -> voice, align, compose (footage untouched: the search term did not move)", () => {
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
    expect(result).toEqual(["voice", "align", "compose"]);
    expect(result).not.toContain("footage");
  });

  it("a script line plus its own search term moving -> voice, footage, align, compose", () => {
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
    expect(invalidatedBy(original, edited)).toEqual(["voice", "footage", "align", "compose"]);
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
