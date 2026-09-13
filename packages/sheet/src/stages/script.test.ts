import { describe, expect, it } from "vitest";
import type { Brief } from "@shortreelcuts/plan";
import { runScript } from "./script.js";

const brief: Brief = { prompt: "a video about why the sky is blue", targetSeconds: 30, tone: "calm" };

describe("runScript (stub)", () => {
  it("is deterministic given the same brief and seed", async () => {
    const a = await runScript({ brief, seed: 41207 });
    const b = await runScript({ brief, seed: 41207 });
    expect(a.patch).toEqual(b.patch);
  });

  it("proposes more than one hook and picks exactly one", async () => {
    const result = await runScript({ brief, seed: 1 });
    const candidates = result.candidates["script.hook"];
    expect(candidates?.length).toBeGreaterThan(1);
    expect(candidates?.filter((c) => c.chosen)).toHaveLength(1);
    expect(candidates?.find((c) => c.chosen)?.label).toBe(result.patch.script.hook);
  });

  it("records a non-empty reason for the script it produced", async () => {
    const result = await runScript({ brief, seed: 1 });
    expect(result.patch.script.reason.length).toBeGreaterThan(0);
  });

  it("scales beat count with the target duration, within the readable 2-5 bound", async () => {
    const short = await runScript({ brief: { ...brief, targetSeconds: 15 }, seed: 1 });
    const long = await runScript({ brief: { ...brief, targetSeconds: 60 }, seed: 1 });
    expect(short.patch.script.beats.length).toBeGreaterThanOrEqual(2);
    expect(long.patch.script.beats.length).toBeLessThanOrEqual(5);
    expect(long.patch.script.beats.length).toBeGreaterThanOrEqual(short.patch.script.beats.length);
  });
});
