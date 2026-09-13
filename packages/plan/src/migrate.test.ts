import { describe, expect, it } from "vitest";
import { migrate, PlanVersionError } from "./migrate.js";
import { makeFixturePlan } from "./testing/fixtures.js";

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
