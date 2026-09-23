import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invalidateScoped, type Plan } from "@shortreelcuts/plan";
import { runFrames } from "./frames.js";
import { makeSheetFixturePlan } from "./testing/fixtures.js";

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function makeThreeBeatMixedPlan(): Plan {
  const plan = makeSheetFixturePlan();
  return {
    ...plan,
    script: {
      ...plan.script,
      beats: [
        { id: "b1", narration: "First beat about stock clips.", onScreen: "Stock", search: "nature" },
        { id: "b2", narration: "Second beat about AI video.", onScreen: "AI Video", search: "future city" },
        { id: "b3", narration: "Third beat with code animations.", onScreen: "Motion", search: "charts" },
      ],
    },
    footage: {
      b1: {
        source: "stock",
        provider: "pexels",
        assetId: "stock-1",
        in: 0,
        out: 4,
        credit: { creator: "stock creator", pageUrl: "https://pexels.com/video/1" },
        reason: "stock clip for natural scenery",
      },
      b2: {
        source: "generated",
        provider: "veo",
        model: "veo-3.1",
        prompt: "futuristic city with flying vehicles",
        seconds: 4,
        quotedCost: { amount: 0.4, currency: "USD", basis: "Veo 3.1, $0.10/s" },
        reason: "AI generated video for speculative concept",
      },
      b3: {
        source: "motion",
        runtime: "srcuts-motion@1",
        scene: {
          kind: "code",
          html: "<div class='scene'>Stats</div>",
          css: ".scene { color: #fff; }",
          js: "",
        },
        captionsInScene: true,
        model: "connected-model",
        reason: "code-rendered motion graphics for data",
      },
    },
    align: {
      ...plan.align,
      words: {
        b1: [{ word: "Stock", startSeconds: 0, endSeconds: 2.0 }],
        b2: [{ word: "AI", startSeconds: 0, endSeconds: 2.0 }],
        b3: [{ word: "Motion", startSeconds: 0, endSeconds: 2.0 }],
      },
    },
  };
}

describe("frames stage", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "srcuts-frames-test-"));
  });

  afterEach(async () => {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  it("normalises stock, generated, and motion footage into intermediate clips", async () => {
    const plan = makeThreeBeatMixedPlan();
    const result = await runFrames({ plan, workDir });

    expect(result.renderedBeats).toEqual(["b1", "b2", "b3"]);
    expect(result.clips["b1"]).toBeTruthy();
    expect(result.clips["b2"]).toBeTruthy();
    expect(result.clips["b3"]).toBeTruthy();
    expect(result.patch.render?.runtime).toBe("srcuts-motion@1");
  });

  it("changing one beat's plan and re-rendering only re-renders the invalidated beat(s)", async () => {
    const initialPlan = makeThreeBeatMixedPlan();

    // First render: produces intermediate clips for all three beats
    const firstRun = await runFrames({ plan: initialPlan, workDir });
    expect(firstRun.renderedBeats).toEqual(["b1", "b2", "b3"]);

    const b1Path = firstRun.clips["b1"]!;
    const b2Path = firstRun.clips["b2"]!;
    const b3Path = firstRun.clips["b3"]!;

    const b1StatBefore = await stat(b1Path);
    const b2StatBefore = await stat(b2Path);
    const b3StatBefore = await stat(b3Path);

    const b2BytesBefore = await readFile(b2Path);
    const b3BytesBefore = await readFile(b3Path);
    const b2HashBefore = sha256(b2BytesBefore);
    const b3HashBefore = sha256(b3BytesBefore);

    // Wait a brief delay to ensure any file touch would produce a differing mtimeMs
    await new Promise((r) => setTimeout(r, 60));

    // Change ONLY beat 1: swap stock clip assetId and in/out
    const originalB1 = initialPlan.footage["b1"] as {
      source: "stock";
      provider: string;
      assetId: string;
      in: number;
      out: number;
      credit: { creator: string; pageUrl: string };
      reason: string;
    };
    const modifiedPlan: Plan = {
      ...initialPlan,
      footage: {
        ...initialPlan.footage,
        b1: {
          source: "stock",
          provider: originalB1.provider,
          assetId: "stock-1-alternate-cut",
          in: 1,
          out: 5,
          credit: originalB1.credit,
          reason: originalB1.reason,
        },
      },
    };

    // Calculate scoped invalidation
    const changedPaths = ["footage.b1.assetId", "footage.b1.in", "footage.b1.out"];
    const scoped = invalidateScoped(changedPaths, modifiedPlan);
    const framesScope = scoped.find((s) => s.stage === "frames");
    expect(framesScope).toBeDefined();
    expect(framesScope?.beats).toEqual(new Set(["b1"]));

    // Re-run frames stage with scoped invalidation
    const secondRun = await runFrames({
      plan: modifiedPlan,
      workDir,
      ...(framesScope?.beats !== undefined ? { scopedBeats: framesScope.beats } : {}),
    });

    // Only beat 1 was re-rendered
    expect(secondRun.renderedBeats).toEqual(["b1"]);

    // Beat 1 was re-rendered
    const b1StatAfter = await stat(secondRun.clips["b1"]!);
    expect(b1StatAfter.mtimeMs).toBeGreaterThanOrEqual(b1StatBefore.mtimeMs);

    // Unaffected beats b2 and b3 render artifacts are UNTOUCHED (same mtime and same hash)
    const b2StatAfter = await stat(secondRun.clips["b2"]!);
    const b3StatAfter = await stat(secondRun.clips["b3"]!);

    expect(b2StatAfter.mtimeMs).toBe(b2StatBefore.mtimeMs);
    expect(b3StatAfter.mtimeMs).toBe(b3StatBefore.mtimeMs);

    const b2BytesAfter = await readFile(secondRun.clips["b2"]!);
    const b3BytesAfter = await readFile(secondRun.clips["b3"]!);

    expect(sha256(b2BytesAfter)).toBe(b2HashBefore);
    expect(sha256(b3BytesAfter)).toBe(b3HashBefore);
  });
});
