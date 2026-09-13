/**
 * The claim this package has to prove for real, not just against a fake:
 * "only compose is real." This runs the actual stub script/voice/footage/
 * align stages together with the actual `runCompose` — real synthesized
 * media, real `ffmpeg`, a real playable MP4 — through `ProjectSession`,
 * and checks that an override still re-runs exactly what
 * `@shortreelcuts/plan`'s `invalidate()` predicts, with the cost shown
 * before any of it.
 *
 * Opt in with `SHORTREELCUTS_RENDER_E2E=1` (see the root `test:e2e`
 * script and `@shortreelcuts/render`'s own end-to-end test, which this
 * mirrors). Skipped otherwise so `npm test` stays fast and needs no
 * `ffmpeg`.
 */
import { access, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { invalidate } from "@shortreelcuts/plan";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ProjectSession } from "./session.js";
import { runAlign } from "./stages/align.js";
import { runCompose } from "./stages/compose.js";
import { runFootage } from "./stages/footage.js";
import { runScript } from "./stages/script.js";
import { runVoice } from "./stages/voice.js";
import type { StageRunners } from "./stages/types.js";

const RUN_E2E = process.env["SHORTREELCUTS_RENDER_E2E"] === "1";

describe.skipIf(!RUN_E2E)("ProjectSession against the real compose stage", () => {
  let workDir: string;
  let runners: { [K in keyof StageRunners]: ReturnType<typeof vi.fn<StageRunners[K]>> };
  let session: ProjectSession;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "shortreelcuts-sheet-e2e-"));
  }, 30_000);

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it(
    "generate() produces a real, playable MP4 via the real compose stage",
    async () => {
      runners = { script: vi.fn(runScript), voice: vi.fn(runVoice), footage: vi.fn(runFootage), align: vi.fn(runAlign), compose: vi.fn(runCompose) };
      session = new ProjectSession({ runners, workDir });

      const plan = await session.generate({ brief: { prompt: "a video about why leaves change colour", targetSeconds: 20, tone: "calm" }, seed: 99 });

      expect(plan.script.beats.length).toBeGreaterThan(0);
      expect(runners.compose).toHaveBeenCalledTimes(1);

      const video = session.lastVideo;
      expect(video).toBeDefined();
      const info = await stat(video!.path);
      expect(info.size).toBeGreaterThan(0);
      expect(video!.durationSeconds).toBeGreaterThan(0);
      await expect(access(video!.captionsPath)).resolves.toBeUndefined(); // the sidecar .srt exists too
    },
    60_000,
  );

  it(
    "overriding the voice re-runs voice, align and real compose only — a real second render",
    async () => {
      vi.clearAllMocks();

      const result = await session.applyOverride([["voice.voiceId", "confident-male"]]);

      expect(result.ranStages).toEqual(invalidate(["voice.voiceId"]));
      expect(result.ranStages).toEqual(["voice", "align", "compose"]);
      expect(runners.script).not.toHaveBeenCalled();
      expect(runners.footage).not.toHaveBeenCalled();
      expect(runners.voice).toHaveBeenCalledTimes(1);
      expect(runners.align).toHaveBeenCalledTimes(1);
      expect(runners.compose).toHaveBeenCalledTimes(1); // a real, second ffmpeg render

      expect(result.plan.voice.voiceId).toBe("confident-male");
      const info = await stat(session.lastVideo!.path);
      expect(info.size).toBeGreaterThan(0);
    },
    60_000,
  );

  it(
    "swapping a footage clip re-runs real compose only — no script/voice/footage/align call at all",
    async () => {
      vi.clearAllMocks();
      const otherClip = session.candidatesFor("footage.b1")?.find((c) => !c.chosen);
      expect(otherClip).toBeDefined();

      const result = await session.applyOverride([["footage.b1.assetId", otherClip!.id]]);

      expect(result.ranStages).toEqual(["compose"]);
      expect(runners.script).not.toHaveBeenCalled();
      expect(runners.voice).not.toHaveBeenCalled();
      expect(runners.footage).not.toHaveBeenCalled();
      expect(runners.align).not.toHaveBeenCalled();
      expect(runners.compose).toHaveBeenCalledTimes(1);

      const info = await stat(session.lastVideo!.path);
      expect(info.size).toBeGreaterThan(0);
    },
    60_000,
  );

  it(
    "reports the cost estimate before the real compose stage starts",
    async () => {
      const log: string[] = [];
      const observedRunners = { script: vi.fn(runScript), voice: vi.fn(runVoice), footage: vi.fn(runFootage), align: vi.fn(runAlign), compose: vi.fn(runCompose) };
      const observedSession = new ProjectSession({
        runners: observedRunners,
        workDir,
        events: { onCostEstimate: () => log.push("cost"), onStageStart: (s) => log.push(`start:${s}`) },
      });
      await observedSession.generate({ brief: { prompt: "a short one", targetSeconds: 15, tone: "calm" }, seed: 3 });
      log.length = 0;

      await observedSession.applyOverride([["captions.style", "minimal-white"]]);

      expect(log).toEqual(["cost", "start:compose"]);
    },
    60_000,
  );
});
