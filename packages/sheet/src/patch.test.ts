import { describe, expect, it } from "vitest";
import { getAtPath, nearestReasonPath, setAllAtPaths, setAtPath } from "./patch.js";

describe("setAtPath", () => {
  it("sets a top-level leaf without touching sibling fields", () => {
    const before = { a: 1, b: { c: 2 } };
    const after = setAtPath(before, "b.c", 99);
    expect(after).toEqual({ a: 1, b: { c: 99 } });
    expect(before).toEqual({ a: 1, b: { c: 2 } }); // never mutated
  });

  it("sets inside an array by numeric index", () => {
    const before = { beats: [{ id: "b1", narration: "old" }] };
    const after = setAtPath(before, "beats.0.narration", "new");
    expect(after).toEqual({ beats: [{ id: "b1", narration: "new" }] });
  });

  it("only clones the nodes on the path, leaving unrelated siblings referentially unchanged", () => {
    const untouched = { keep: "me" };
    const before = { untouched, target: { value: 1 } };
    const after = setAtPath(before, "target.value", 2);
    expect(after.untouched).toBe(untouched);
  });
});

describe("setAllAtPaths", () => {
  it("applies several edits at once", () => {
    const before = { a: 1, b: 2, c: 3 };
    const after = setAllAtPaths(before, [
      ["a", 10],
      ["c", 30],
    ]);
    expect(after).toEqual({ a: 10, b: 2, c: 30 });
  });
});

describe("getAtPath", () => {
  it("reads a nested value", () => {
    expect(getAtPath({ a: { b: [{ c: 5 }] } }, "a.b.0.c")).toBe(5);
  });

  it("returns undefined for a missing path", () => {
    expect(getAtPath({ a: 1 }, "a.b.c")).toBeUndefined();
  });
});

describe("nearestReasonPath", () => {
  const plan = {
    voice: { voiceId: "x", reason: "why voice" },
    script: {
      hook: "h",
      reason: "why script",
      beats: [{ id: "b1", narration: "n" }],
    },
    format: { width: 1080 },
  };

  it("finds a reason on the immediate parent", () => {
    expect(nearestReasonPath(plan, "voice.voiceId")).toBe("voice.reason");
  });

  it("walks up past a node with no reason of its own", () => {
    expect(nearestReasonPath(plan, "script.beats.0.narration")).toBe("script.reason");
  });

  it("returns null when nothing on the way up has a reason", () => {
    expect(nearestReasonPath(plan, "format.width")).toBeNull();
  });
});
