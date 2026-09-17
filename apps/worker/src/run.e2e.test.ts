/**
 * Proves the two hardest lines in this package's job — against a real
 * Postgres, not a mock of one:
 *
 * - "Killing the worker mid-render and restarting it resumes from the
 *   last completed stage rather than starting over."
 * - "A browser refresh mid-render loses nothing; the job continues and
 *   reattaches."
 *
 * A real process kill can't be scripted from inside the process being
 * killed, so "killed mid-render" is simulated the way it actually
 * happens from the database's point of view: one `runJob` call is left
 * stuck partway through a stage (its promise never resolves — nothing
 * about a `kill -9` ever runs the try/catch in `run.ts` either) and is
 * abandoned, never awaited to completion. A second, independent `runJob`
 * call for the same job id — the "restart" — is then awaited to
 * completion. The two calls share nothing but the database row, which is
 * exactly what a real worker restart would share.
 *
 * Opt in with `SHORTREELCUTS_WORKER_E2E=1` and `SHORTREELCUTS_DATABASE_URL`
 * (see the root `test:worker` script). Skipped otherwise so `npm test`
 * needs no Postgres.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAlign, runFootage, runScript, runVoice, type ComposeRunResult, type StageRunners } from "@shortreelcuts/stages";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { connect, createJob, getJob, runMigrations, type Database } from "@shortreelcuts/db";
import type { PgBoss } from "pg-boss";
import { createJobAndEnqueue, getJobProgress } from "./api.js";
import { startQueue, workRenderQueue, type RenderJobData } from "./queue.js";
import { runJob } from "./run.js";

const RUN_E2E = process.env["SHORTREELCUTS_WORKER_E2E"] === "1";
const DATABASE_URL = process.env["SHORTREELCUTS_DATABASE_URL"];

function fakeVideo(path: string) {
  return { path, captionsPath: `${path}.srt`, width: 1080, height: 1920, fps: 30, durationSeconds: 12 };
}

/** Real script/voice/footage/align (fast, no I/O) so resumability is proven against the actual stage logic, plus a fake compose that skips ffmpeg — the same reasoning `packages/sheet`'s own test doubles give for doing this. */
function makeSpiedRunners(): { runners: StageRunners; calls: Record<string, number> } {
  const calls: Record<string, number> = { script: 0, voice: 0, footage: 0, align: 0, compose: 0 };
  return {
    calls,
    runners: {
      script: (input) => {
        calls["script"]!++;
        return runScript(input);
      },
      voice: (input) => {
        calls["voice"]!++;
        return runVoice(input);
      },
      footage: (input) => {
        calls["footage"]!++;
        return runFootage(input);
      },
      align: (input) => {
        calls["align"]!++;
        return runAlign(input);
      },
      compose: (input): Promise<ComposeRunResult> => {
        calls["compose"]!++;
        const plan = input.plan;
        return Promise.resolve({
          patch: { captions: plan.captions, music: plan.music, format: plan.format },
          candidates: {},
          video: fakeVideo(`${input.workDir}/output.mp4`),
        });
      },
    },
  };
}

/** Identical to `makeSpiedRunners`, except `footage` never resolves — standing in for a worker that died mid-stage. Nothing about a real kill runs `run.ts`'s catch block either, so this deliberately never rejects. */
function makeStuckAtFootageRunners(): { runners: StageRunners; calls: Record<string, number> } {
  const spied = makeSpiedRunners();
  return {
    calls: spied.calls,
    runners: {
      ...spied.runners,
      footage: () => {
        spied.calls["footage"]!++;
        return new Promise<never>(() => {
          /* never resolves — simulates the process dying mid-stage */
        });
      },
    },
  };
}

describe.skipIf(!RUN_E2E)("job resumability against a real Postgres", () => {
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

  it("resumes from the last completed stage instead of starting over, and a mid-run read sees exactly the completed stages", async () => {
    workDir = await mkdtemp(join(tmpdir(), "shortreelcuts-worker-"));
    const brief = { prompt: "a video about tide pools", targetSeconds: 24, tone: "calm" };

    const { runners: stuckRunners, calls: stuckCalls } = makeStuckAtFootageRunners();

    const jobId = await createJob(db, { brief, seed: 11 });

    // Fire the "worker that dies mid-footage" — deliberately not awaited, standing in for a killed process.
    void runJob(db, workDir, stuckRunners, jobId);

    // Give the un-awaited run room to actually reach and get stuck in footage.
    await vi.waitFor(async () => {
      const row = await getJob(db, jobId);
      expect(row?.completedStages).toEqual(["script", "voice"]);
    }, { timeout: 2000, interval: 20 });

    // "A browser refresh mid-render loses nothing; the job continues and reattaches" — read progress mid-run.
    const midProgress = await getJobProgress(db, jobId);
    expect(midProgress?.status).toBe("running");
    expect(midProgress?.completedStages).toEqual(["script", "voice"]);
    expect(midProgress?.videoPath).toBeNull();
    const candidates = midProgress?.candidates as Record<string, unknown>;
    expect(candidates).toBeDefined();
    expect(Object.keys(candidates)).toContain("script.hook");
    expect(Object.keys(candidates)).not.toContain("footage.b1"); // hasn't completed yet
    expect(stuckCalls["script"]).toBe(1);
    expect(stuckCalls["voice"]).toBe(1);
    expect(stuckCalls["footage"]).toBe(1); // called, but never returns

    // "Restart": a brand new runJob call for the same job id, with working runners this time.
    const { runners: restartRunners, calls: restartCalls } = makeSpiedRunners();
    await runJob(db, workDir, restartRunners, jobId);

    const finalRow = await getJob(db, jobId);
    expect(finalRow?.status).toBe("done");
    expect(finalRow?.completedStages).toEqual(["script", "voice", "footage", "align", "frames", "compose"]);
    expect(finalRow?.videoPath).toBe(`${workDir}/output.mp4`);

    // The load-bearing assertion: script and voice were never re-run on restart. Only the stages
    // that had not yet completed ran, and each of those ran exactly once.
    expect(restartCalls["script"]).toBe(0);
    expect(restartCalls["voice"]).toBe(0);
    expect(restartCalls["footage"]).toBe(1);
    expect(restartCalls["align"]).toBe(1);
    expect(restartCalls["compose"]).toBe(1);
  });

  it("a fully completed job is a no-op on a second runJob call", async () => {
    workDir = await mkdtemp(join(tmpdir(), "shortreelcuts-worker-"));
    const brief = { prompt: "a video about lighthouses", targetSeconds: 20, tone: "calm" };
    const jobId = await createJob(db, { brief, seed: 12 });

    const { runners } = makeSpiedRunners();
    await runJob(db, workDir, runners, jobId);
    const { calls: secondCalls, runners: secondRunners } = makeSpiedRunners();
    await runJob(db, workDir, secondRunners, jobId);

    expect(secondCalls["script"]).toBe(0);
    expect(secondCalls["voice"]).toBe(0);
    expect(secondCalls["footage"]).toBe(0);
    expect(secondCalls["align"]).toBe(0);
    expect(secondCalls["compose"]).toBe(0);
  });

  it("kills a real operating-system process mid-job and restarts from the last completed stage", async () => {
    workDir = await mkdtemp(join(tmpdir(), "shortreelcuts-worker-real-kill-"));
    const sentinel = join(workDir, "resume-sentinel");
    const brief = { prompt: "a video about deep sea vents", targetSeconds: 24, tone: "calm" };
    
    const jobId = await createJob(db, { brief, seed: 42 });

    const { spawn } = await import("node:child_process");
    // spawn vitest to run the victim file. Use detached to create a new process group.
    const child = spawn("npx", ["vitest", "run", "apps/worker/src/kill-victim.fixture.test.ts"], {
      env: {
        ...process.env,
        VICTIM_JOB_ID: jobId,
        VICTIM_SENTINEL: sentinel,
        VICTIM_WORKDIR: workDir,
        SHORTREELCUTS_DATABASE_URL: DATABASE_URL,
      },
      detached: true,
      stdio: "ignore",
    });

    // wait until the database row genuinely shows ["script", "voice"]
    await vi.waitFor(async () => {
      const row = await getJob(db, jobId);
      expect(row?.completedStages).toEqual(["script", "voice"]);
    }, { timeout: 10000, interval: 100 });

    // Send SIGKILL to the whole process group
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (e) {
        // ignore if already dead
      }
    }
    
    // Wait for the exit event to ensure it's fully gone
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.on("exit", () => resolve());
    });

    // Restart: run the job again in this parent process
    const { runners: restartRunners, calls: restartCalls } = makeSpiedRunners();
    await runJob(db, workDir, restartRunners, jobId);

    const finalRow = await getJob(db, jobId);
    expect(finalRow?.status).toBe("done");
    expect(finalRow?.completedStages).toEqual(["script", "voice", "footage", "align", "frames", "compose"]);
    expect(finalRow?.videoPath).toBe(`${workDir}/output.mp4`);

    // script and voice were already done, so they should not re-run
    expect(restartCalls["script"]).toBe(0);
    expect(restartCalls["voice"]).toBe(0);
    expect(restartCalls["footage"]).toBe(1);
    expect(restartCalls["align"]).toBe(1);
    expect(restartCalls["compose"]).toBe(1);
  }, 15000);

  it("the job API creates a job, enqueues it, and the queued worker resumes and completes it", async () => {
    workDir = await mkdtemp(join(tmpdir(), "shortreelcuts-worker-"));
    const brief = { prompt: "a video about paper maps", targetSeconds: 18, tone: "calm" };
    const boss: PgBoss = await startQueue(DATABASE_URL as string);
    const { runners } = makeSpiedRunners();

    try {
      const jobId = await createJobAndEnqueue(db, boss, { brief, seed: 13 });

      const completed = new Promise<void>((resolve) => {
        void workRenderQueue(boss, async (id: RenderJobData["jobId"]) => {
          await runJob(db, workDir, runners, id);
          resolve();
        });
      });
      await completed;

      const progress = await getJobProgress(db, jobId);
      expect(progress?.status).toBe("done");
      expect(progress?.videoPath).toBe(`${workDir}/output.mp4`);
    } finally {
      await boss.stop({ graceful: false });
    }
  });
});
