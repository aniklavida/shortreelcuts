/**
 * The parts of the frames stage that are pure: which artefact a beat's
 * normalized clip lives in, and the rule that a beat which was not
 * invalidated keeps the clip it already has instead of being re-encoded.
 *
 * Nothing here spawns an encoder, per AGENTS.md. Every beat in this file
 * already has a clip, so the stage never reaches ffmpeg — the encode itself,
 * and the mtimes and bytes it produces, are proved in `frames.e2e.test.ts`
 * behind `SHORTREELCUTS_RENDER_E2E=1`.
 */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contentKeyFor, type Plan } from "@shortreelcuts/plan";
import { runFrames } from "./frames.js";
import { makeSheetFixturePlan } from "./testing/fixtures.js";

function artifactPathFor(workDir: string, plan: Plan, beatId: string): string {
  const key = contentKeyFor("frames", plan, beatId);
  return join(workDir, "frames", `${beatId}-${key.replace(/[^a-zA-Z0-9_-]/g, "_")}.mp4`);
}

describe("frames stage", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "srcuts-frames-pure-"));
    await mkdir(join(workDir, "frames"), { recursive: true });
  });

  afterEach(async () => {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  it("names a beat's artefact after that beat's content key, so a later run can find it", () => {
    const plan = makeSheetFixturePlan();
    const b1Path = artifactPathFor(workDir, plan, "b1");
    const b2Path = artifactPathFor(workDir, plan, "b2");

    // The key is `sha256:<digest>`; the stage replaces the characters a
    // filesystem cannot take, so the digest survives and the name stays flat.
    const b1Key = contentKeyFor("frames", plan, "b1");
    const b1Digest = b1Key.slice(b1Key.indexOf(":") + 1);

    expect(b1Path.startsWith(join(workDir, "frames", "b1-"))).toBe(true);
    expect(b1Path.endsWith(".mp4")).toBe(true);
    expect(b1Path).toContain(b1Digest);
    expect(b1Path).not.toContain(":");
    expect(b2Path).toBe(join(workDir, "frames", `b2-${contentKeyFor("frames", plan, "b2").replace(":", "_")}.mp4`));
  });

  it("reuses each existing clip whose beat was not invalidated, byte for byte", async () => {
    const plan = makeSheetFixturePlan();
    const b1Path = artifactPathFor(workDir, plan, "b1");
    const b2Path = artifactPathFor(workDir, plan, "b2");
    await writeFile(b1Path, "existing-clip-b1");
    await writeFile(b2Path, "existing-clip-b2");

    const b1Before = await stat(b1Path);
    const b2Before = await stat(b2Path);

    // b3 is not in the plan, so scoping to it invalidates nothing. Neither
    // b1 nor b2 may be re-encoded: the fast suite has no encoder to re-encode
    // with, and re-encoding an unaffected beat is exactly the bug the
    // per-beat content key exists to prevent.
    const result = await runFrames({ plan, workDir, scopedBeats: new Set(["b3"]) });

    expect(result.renderedBeats).toEqual([]);
    expect(result.clips["b1"]).toBe(b1Path);
    expect(result.clips["b2"]).toBe(b2Path);
    expect(await readFile(b1Path, "utf8")).toBe("existing-clip-b1");
    expect(await readFile(b2Path, "utf8")).toBe("existing-clip-b2");
    expect((await stat(b1Path)).mtimeMs).toBe(b1Before.mtimeMs);
    expect((await stat(b2Path)).mtimeMs).toBe(b2Before.mtimeMs);
  });

  it("prefers a cached clip over the artefact on disk when a beat was not invalidated", async () => {
    const plan = makeSheetFixturePlan();
    const onDisk = artifactPathFor(workDir, plan, "b1");
    const b2Path = artifactPathFor(workDir, plan, "b2");
    const cachedPath = join(workDir, "cached-b1.mp4");
    await writeFile(onDisk, "stale-clip");
    await writeFile(b2Path, "existing-clip-b2");
    await writeFile(cachedPath, "cached-clip");

    const result = await runFrames({
      plan,
      workDir,
      scopedBeats: new Set(["b3"]),
      clipCache: { b1: cachedPath },
    });

    expect(result.renderedBeats).toEqual([]);
    expect(result.clips["b1"]).toBe(cachedPath);
    expect(result.clips["b2"]).toBe(b2Path);
    expect(await readFile(cachedPath, "utf8")).toBe("cached-clip");
    expect(await readFile(onDisk, "utf8")).toBe("stale-clip");
  });
});
