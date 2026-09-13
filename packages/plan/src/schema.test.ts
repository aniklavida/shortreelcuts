import { describe, expect, it } from "vitest";
import { CURRENT_PLAN_VERSION, parsePlan, PlanSchema } from "./schema.js";
import { makeFixturePlan } from "./testing/fixtures.js";

describe("PlanSchema", () => {
  it("accepts a fully-decided plan", () => {
    expect(() => parsePlan(makeFixturePlan())).not.toThrow();
  });

  it("planVersion is 1 at v1", () => {
    expect(CURRENT_PLAN_VERSION).toBe(1);
    expect(makeFixturePlan().planVersion).toBe(1);
  });

  it("rejects an unknown top-level field", () => {
    const withExtra = { ...makeFixturePlan(), somethingElse: true };
    expect(() => parsePlan(withExtra)).toThrow();
  });

  it("rejects a decision with no reason", () => {
    const plan = makeFixturePlan();
    const { reason: _reason, ...voiceWithoutReason } = plan.voice;
    expect(() => parsePlan({ ...plan, voice: voiceWithoutReason })).toThrow();
  });

  it("rejects a decision with a blank reason", () => {
    const plan = makeFixturePlan();
    expect(() => parsePlan({ ...plan, script: { ...plan.script, reason: "" } })).toThrow();
  });

  it("rejects a footage clip whose out is not after its in", () => {
    const plan = makeFixturePlan();
    expect(() =>
      parsePlan({
        ...plan,
        footage: { ...plan.footage, b1: { ...plan.footage["b1"], in: 5, out: 2 } },
      }),
    ).toThrow();
  });

  it("rejects an aligned word whose end is not after its start", () => {
    const plan = makeFixturePlan();
    expect(() =>
      parsePlan({
        ...plan,
        align: {
          ...plan.align,
          words: { ...plan.align.words, b1: [{ word: "x", startSeconds: 1, endSeconds: 1 }] },
        },
      }),
    ).toThrow();
  });

  it("rejects music enabled without a provider and track", () => {
    const plan = makeFixturePlan();
    expect(() =>
      parsePlan({ ...plan, music: { enabled: true, volume: 0.5, reason: "background bed" } }),
    ).toThrow();
  });

  it("accepts music enabled with a provider and track", () => {
    const plan = makeFixturePlan();
    expect(() =>
      parsePlan({
        ...plan,
        music: {
          enabled: true,
          provider: "stub",
          trackId: "track-1",
          volume: 0.2,
          reason: "a quiet bed under the narration",
        },
      }),
    ).not.toThrow();
  });

  it("rejects an output format other than the v1 default", () => {
    const plan = makeFixturePlan();
    expect(() =>
      parsePlan({ ...plan, format: { ...plan.format, width: 1920, height: 1080 } }),
    ).toThrow();
  });

  it("rejects a plan with no beats", () => {
    const plan = makeFixturePlan();
    expect(() => parsePlan({ ...plan, script: { ...plan.script, beats: [] } })).toThrow();
  });

  it("PlanSchema.safeParse reports failure without throwing", () => {
    const result = PlanSchema.safeParse({ not: "a plan" });
    expect(result.success).toBe(false);
  });
});
