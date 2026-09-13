/**
 * Exercises the spawn wrapper itself — argument handling and error
 * surfacing — against `/usr/bin/true` and `/usr/bin/false` rather than a
 * real `ffmpeg`. Per STRUCTURE.md, this package's actual encodes are
 * proved separately in `testing/render.e2e.test.ts`; this file is pure
 * process-spawning behaviour.
 */
import { describe, expect, it } from "vitest";
import { runFfmpeg, runFfprobe } from "./process.js";

describe("runFfmpeg", () => {
  it("resolves with stdout/stderr when the process exits 0", async () => {
    const result = await runFfmpeg("true", []);
    expect(result).toEqual({ stdout: "", stderr: "" });
  });

  it("throws with the process's stderr when it exits non-zero", async () => {
    await expect(runFfmpeg("false", [])).rejects.toThrow(/ffmpeg failed/);
  });

  it("rejects with a clear error when the binary does not exist", async () => {
    await expect(runFfmpeg("shortreelcuts-does-not-exist", [])).rejects.toThrow();
  });
});

describe("runFfprobe", () => {
  it("resolves with stdout when the process exits 0", async () => {
    const result = await runFfprobe("true", []);
    expect(result).toBe("");
  });

  it("throws with a clear error when it exits non-zero", async () => {
    await expect(runFfprobe("false", [])).rejects.toThrow(/ffprobe failed/);
  });
});
