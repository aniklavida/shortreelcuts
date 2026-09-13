/**
 * Determinism, proved at the level this card can prove it at: there is no
 * renderer yet, so "two renders of one plan produce identical output" is
 * demonstrated as "two content-addressed keys computed from one plan, or
 * from two structurally-identical plans, are byte-identical" — which is
 * exactly the property a real renderer would need to hold to make
 * byte-identical re-rendering true once it exists.
 */
import { describe, expect, it } from "vitest";
import { contentKeyFor, contentKeysFor, stageInputPaths } from "./artifact.js";
import { invalidate } from "./graph.js";
import { diffPaths, STAGES, type Stage } from "./index.js";
import type { Plan } from "./schema.js";
import { makeFixturePlan } from "./testing/fixtures.js";

describe("determinism: the same plan produces the same key twice", () => {
  it("calling contentKeyFor twice on the same plan object is byte-identical", () => {
    const plan = makeFixturePlan();
    for (const stage of STAGES) {
      expect(contentKeyFor(stage, plan)).toBe(contentKeyFor(stage, plan));
    }
  });

  it("calling contentKeyFor on two independently-built, value-equal plans is byte-identical", () => {
    const a = makeFixturePlan();
    const b = makeFixturePlan(); // a second, distinct object with the same decisions
    expect(a).not.toBe(b);
    for (const stage of STAGES) {
      expect(contentKeyFor(stage, a)).toBe(contentKeyFor(stage, b));
    }
  });

  it("survives a JSON round trip (the shape a stored or exported plan takes)", () => {
    const plan = makeFixturePlan();
    const roundTripped: Plan = JSON.parse(JSON.stringify(plan));
    for (const stage of STAGES) {
      expect(contentKeyFor(stage, plan)).toBe(contentKeyFor(stage, roundTripped));
    }
  });

  it("does not depend on top-level or nested object key order", () => {
    const plan = makeFixturePlan();
    const reordered: Plan = {
      ...JSON.parse(JSON.stringify(plan)),
      voice: { reason: plan.voice.reason, rate: plan.voice.rate, voiceId: plan.voice.voiceId, provider: plan.voice.provider },
    };
    const reorderedTop = Object.fromEntries(Object.entries(reordered).reverse()) as unknown as Plan;
    for (const stage of STAGES) {
      expect(contentKeyFor(stage, plan)).toBe(contentKeyFor(stage, reorderedTop));
    }
  });

  it("keys are namespaced by stage — two different stages never collide", () => {
    const keys = contentKeysFor(makeFixturePlan());
    const values = Object.values(keys);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("content addressing agrees with invalidate(): unchanged stages are reusable", () => {
  function keysChangedBy(before: Plan, after: Plan): Stage[] {
    const beforeKeys = contentKeysFor(before);
    const afterKeys = contentKeysFor(after);
    return STAGES.filter((stage) => beforeKeys[stage] !== afterKeys[stage]);
  }

  const scenarios: ReadonlyArray<[string, (plan: Plan) => Plan]> = [
    ["caption style", (p) => ({ ...p, captions: { ...p.captions, style: "handwritten" } })],
    [
      "swap a clip",
      (p) => ({ ...p, footage: { ...p.footage, b1: { ...p.footage["b1"]!, assetId: "alt-clip" } } }),
    ],
    ["voice rate", (p) => ({ ...p, voice: { ...p.voice, rate: 1.4 } })],
    [
      "a beat's search term",
      (p) => ({
        ...p,
        script: {
          ...p.script,
          beats: [p.script.beats[0]!, { ...p.script.beats[1]!, search: "a new search term" }],
        },
      }),
    ],
    ["the prompt", (p) => ({ ...p, brief: { ...p.brief, prompt: "a different prompt entirely" } })],
  ];

  for (const [label, edit] of scenarios) {
    it(`${label}: exactly the stages invalidate() names have a new artefact key`, () => {
      const before = makeFixturePlan();
      const after = edit(before);
      const expectedToRerun = invalidate(diffPaths(before, after));
      const actuallyChangedKeys = keysChangedBy(before, after);
      expect(actuallyChangedKeys.sort()).toEqual([...expectedToRerun].sort());
    });
  }

  it("a reason-only edit changes no artefact key, so every stage's output is reused", () => {
    const before = makeFixturePlan();
    const after: Plan = { ...before, voice: { ...before.voice, reason: "a different explanation" } };
    expect(keysChangedBy(before, after)).toEqual([]);
  });
});

describe("stageInputPaths", () => {
  it("script depends only on brief, seed and its own fields", () => {
    const plan = makeFixturePlan();
    const paths = stageInputPaths("script", plan);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path === "seed" || path.startsWith("brief") || path.startsWith("script")).toBe(true);
    }
  });

  it("compose depends on paths from every stage", () => {
    const plan = makeFixturePlan();
    const paths = stageInputPaths("compose", plan);
    for (const prefix of ["brief", "script", "voice", "footage", "align", "captions", "music", "format"]) {
      expect(paths.some((p) => p.startsWith(prefix))).toBe(true);
    }
  });

  it("never includes a reason path", () => {
    const plan = makeFixturePlan();
    for (const stage of STAGES) {
      expect(stageInputPaths(stage, plan).some((p) => p.endsWith("reason"))).toBe(false);
    }
  });
});
