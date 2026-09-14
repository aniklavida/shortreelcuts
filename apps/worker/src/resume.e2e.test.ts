/**
 * `resumeIncompleteJobs` is what a worker calls once at startup — the
 * automatic half of resumability, as opposed to `run.e2e.test.ts`'s
 * direct proof that `runJob` itself skips completed stages. This proves
 * the startup scan finds every job left `pending` or `running` — the two
 * statuses a job can be stuck in after an unclean shutdown — and drives
 * each to completion without anyone naming a job id by hand.
 *
 * Opt in with `SHORTREELCUTS_WORKER_E2E=1` and `SHORTREELCUTS_DATABASE_URL`
 * (see the root `test:worker` script).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAlign, runFootage, runScript, runVoice, type ComposeRunResult, type StageRunners } from "@shortreelcuts/stages";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { connect, createJob, getJob, runMigrations, type Database } from "@shortreelcuts/db";
import { resumeIncompleteJobs } from "./resume.js";

const RUN_E2E = process.env["SHORTREELCUTS_WORKER_E2E"] === "1";
const DATABASE_URL = process.env["SHORTREELCUTS_DATABASE_URL"];

function fakeVideo(path: string) {
  return { path, captionsPath: `${path}.srt`, width: 1080, height: 1920, fps: 30, durationSeconds: 12 };
}

function makeWorkingRunners(): StageRunners {
  return {
    script: runScript,
    voice: runVoice,
    footage: runFootage,
    align: runAlign,
    compose: (input): Promise<ComposeRunResult> => {
      const plan = input.plan;
      return Promise.resolve({
        patch: { captions: plan.captions, music: plan.music, format: plan.format },
        candidates: {},
        video: fakeVideo(`${input.workDir}/output.mp4`),
      });
    },
  };
}

describe.skipIf(!RUN_E2E)("resumeIncompleteJobs against a real Postgres", () => {
  let db: Database;
  let workDir: string;

  beforeAll(async () => {
    if (!DATABASE_URL) throw new Error("SHORTREELCUTS_DATABASE_URL must be set when SHORTREELCUTS_WORKER_E2E=1");
    db = connect(DATABASE_URL);
    await runMigrations(db.pool);
    await db.pool.query("truncate table jobs");
  });

  afterEach(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  afterAll(async () => {
    await db.close();
  });

  it("drives every pending and running job to completion, and ignores done ones", async () => {
    workDir = await mkdtemp(join(tmpdir(), "shortreelcuts-worker-resume-"));
    const brief = { prompt: "a video about postal routes", targetSeconds: 16, tone: "calm" };

    // A job that never started (worker died before it was even picked up).
    const pendingId = await createJob(db, { brief, seed: 21 });

    // A job that got partway through on a previous, now-dead worker: fired without being
    // awaited (its footage stage never resolves, standing in for a killed process), then
    // abandoned once script and voice are actually recorded.
    const partialId = await createJob(db, { brief, seed: 22 });
    const { runJob } = await import("./run.js");
    void runJob(db, workDir, { ...makeWorkingRunners(), footage: () => new Promise<never>(() => {}) }, partialId);
    await vi.waitFor(async () => {
      const row = await getJob(db, partialId);
      expect(row?.completedStages).toEqual(["script", "voice"]);
    }, { timeout: 2000, interval: 20 });

    // A job that already finished — resuming must not touch it again.
    const doneId = await createJob(db, { brief, seed: 23 });
    await runJob(db, workDir, makeWorkingRunners(), doneId);
    const doneBefore = await getJob(db, doneId);
    expect(doneBefore?.status).toBe("done");

    const resumedIds = await resumeIncompleteJobs(db, workDir, makeWorkingRunners());

    expect(resumedIds).toContain(pendingId);
    expect(resumedIds).toContain(partialId);
    expect(resumedIds).not.toContain(doneId);

    const pendingRow = await getJob(db, pendingId);
    expect(pendingRow?.status).toBe("done");
    expect(pendingRow?.completedStages).toEqual(["script", "voice", "footage", "align", "compose"]);

    const partialRow = await getJob(db, partialId);
    expect(partialRow?.status).toBe("done");
    expect(partialRow?.completedStages).toEqual(["script", "voice", "footage", "align", "compose"]);

    const doneAfter = await getJob(db, doneId);
    expect(doneAfter?.updatedAt).toEqual(doneBefore?.updatedAt);
  });
});
