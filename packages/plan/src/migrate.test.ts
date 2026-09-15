import { describe, expect, it } from "vitest";
import { migrate, PlanVersionError } from "./migrate.js";
import { makeFixturePlan, makeV1FixturePlan } from "./testing/fixtures.js";

describe("migrate", () => {
  it("returns a validated plan unchanged at the current version", () => {
    const plan = makeFixturePlan();
    expect(migrate(plan)).toEqual(plan);
  });

  it("rejects a non-object", () => {
    expect(() => migrate("not a plan")).toThrow(PlanVersionError);
    expect(() => migrate(null)).toThrow(PlanVersionError);
    expect(() => migrate([1, 2, 3])).toThrow(PlanVersionError);
  });

  it("rejects a plan-shaped value with no planVersion", () => {
    const { planVersion: _planVersion, ...withoutVersion } = makeFixturePlan();
    expect(() => migrate(withoutVersion)).toThrow(PlanVersionError);
  });

  it("rejects a planVersion with no migration path", () => {
    const plan = { ...makeFixturePlan(), planVersion: 0 };
    expect(() => migrate(plan)).toThrow(/no migration path/);
  });

  it("rejects a planVersion newer than this build supports", () => {
    const plan = { ...makeFixturePlan(), planVersion: 99 };
    expect(() => migrate(plan)).toThrow(/newer than this build supports/);
  });

  it("still rejects an otherwise-invalid plan at the current version", () => {
    const plan = { ...makeFixturePlan(), format: undefined };
    expect(() => migrate(plan)).toThrow();
  });
});

describe("migrate: planVersion 1 -> 2, the footage union (docs/SPEC.md §11)", () => {
  it("migrates a v1 fixture to a valid v2 plan", () => {
    const migrated = migrate(makeV1FixturePlan());
    expect(migrated.planVersion).toBe(2);
    expect(migrated.footage["b1"]?.source).toBe("stock");
    expect(migrated.footage["b2"]?.source).toBe("stock");
  });

  it("carries every stock field forward unchanged, and synthesizes a placeholder credit", () => {
    const v1 = makeV1FixturePlan();
    const v1Footage = (v1["footage"] as Record<string, Record<string, unknown>>)["b1"] as Record<string, unknown>;
    const migrated = migrate(v1);
    const clip = migrated.footage["b1"];
    expect(clip?.source).toBe("stock");
    if (clip?.source !== "stock") throw new Error("expected a migrated stock clip");
    expect(clip.provider).toBe(v1Footage["provider"]);
    expect(clip.assetId).toBe(v1Footage["assetId"]);
    expect(clip.in).toBe(v1Footage["in"]);
    expect(clip.out).toBe(v1Footage["out"]);
    expect(clip.reason).toBe(v1Footage["reason"]);
    expect(clip.credit.creator.length).toBeGreaterThan(0);
    expect(clip.credit.pageUrl.length).toBeGreaterThan(0);
  });

  it("every other section is untouched by the migration", () => {
    const v1 = makeV1FixturePlan();
    const migrated = migrate(v1);
    expect(migrated.brief).toEqual(v1["brief"]);
    expect(migrated.script).toEqual(v1["script"]);
    expect(migrated.voice).toEqual(v1["voice"]);
    expect(migrated.align).toEqual(v1["align"]);
    expect(migrated.captions).toEqual(v1["captions"]);
    expect(migrated.music).toEqual(v1["music"]);
    expect(migrated.format).toEqual(v1["format"]);
  });

  it("migrating twice (idempotent on an already-current plan) agrees with migrating once", () => {
    const once = migrate(makeV1FixturePlan());
    const twice = migrate(once);
    expect(twice).toEqual(once);
  });
});
