import { describe, expect, it } from "vitest";
import { diffPaths, leavesOf } from "./paths.js";
import { makeFixturePlan } from "./testing/fixtures.js";

describe("leavesOf", () => {
  it("walks nested objects to their leaves", () => {
    expect(leavesOf({ a: { b: { c: 1 } } })).toEqual([{ path: "a.b.c", value: 1 }]);
  });

  it("walks arrays by index", () => {
    expect(leavesOf({ list: [10, 20] })).toEqual([
      { path: "list.0", value: 10 },
      { path: "list.1", value: 20 },
    ]);
  });

  it("treats an empty object as its own leaf", () => {
    expect(leavesOf({ a: {} })).toEqual([{ path: "a", value: {} }]);
  });

  it("treats an empty array as its own leaf", () => {
    expect(leavesOf({ a: [] })).toEqual([{ path: "a", value: [] }]);
  });

  it("a primitive at the root has an empty path", () => {
    expect(leavesOf(5)).toEqual([{ path: "", value: 5 }]);
  });

  it("does not depend on key order", () => {
    const a = leavesOf({ x: 1, y: 2 });
    const b = leavesOf({ y: 2, x: 1 });
    expect(new Set(a.map((l) => `${l.path}=${l.value}`))).toEqual(
      new Set(b.map((l) => `${l.path}=${l.value}`)),
    );
  });
});

describe("diffPaths", () => {
  it("is empty for two structurally identical values", () => {
    expect(diffPaths({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 })).toEqual([]);
  });

  it("finds a single changed leaf", () => {
    expect(diffPaths({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual(["b"]);
  });

  it("finds an added leaf", () => {
    expect(diffPaths({ a: 1 }, { a: 1, b: 2 })).toEqual(["b"]);
  });

  it("finds a removed leaf", () => {
    expect(diffPaths({ a: 1, b: 2 }, { a: 1 })).toEqual(["b"]);
  });

  it("is empty for a plan diffed against an equal-but-freshly-parsed copy of itself", () => {
    const plan = makeFixturePlan();
    const copy = JSON.parse(JSON.stringify(plan));
    expect(diffPaths(plan, copy)).toEqual([]);
  });

  it("finds exactly one path when exactly one field of a real plan changes", () => {
    const plan = makeFixturePlan();
    const edited = { ...plan, voice: { ...plan.voice, rate: 1.25 } };
    expect(diffPaths(plan, edited)).toEqual(["voice.rate"]);
  });

  it("finds every affected path when a nested array entry changes", () => {
    const plan = makeFixturePlan();
    const edited = {
      ...plan,
      script: {
        ...plan.script,
        beats: [{ ...plan.script.beats[0], narration: "a brand new line" }, plan.script.beats[1]],
      },
    };
    expect(diffPaths(plan, edited)).toEqual(["script.beats.0.narration"]);
  });
});
