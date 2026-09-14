/**
 * Proves the jobs repository against a real Postgres — the migration
 * actually runs, a row actually round-trips through jsonb columns.
 *
 * Opt in with `SHORTREELCUTS_WORKER_E2E=1` and `SHORTREELCUTS_DATABASE_URL`
 * pointed at a throwaway database (see the root `test:worker` script).
 * Skipped otherwise so `npm test` needs no Postgres at all — the same
 * pattern `packages/render`'s `SHORTREELCUTS_RENDER_E2E` uses for ffmpeg.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, type Database } from "./client.js";
import { createJob, getJob, listJobsByStatus, markDone, markFailed, markRunning, recordStageCompletion } from "./jobs.js";
import { runMigrations } from "./migrate.js";

const RUN_E2E = process.env["SHORTREELCUTS_WORKER_E2E"] === "1";
const DATABASE_URL = process.env["SHORTREELCUTS_DATABASE_URL"];

describe.skipIf(!RUN_E2E)("jobs repository against a real Postgres", () => {
  let db: Database;

  beforeAll(async () => {
    if (!DATABASE_URL) throw new Error("SHORTREELCUTS_DATABASE_URL must be set when SHORTREELCUTS_WORKER_E2E=1");
    db = connect(DATABASE_URL);
    await runMigrations(db.pool);
    await db.pool.query("truncate table jobs");
  });

  afterAll(async () => {
    await db.close();
  });

  it("round-trips a created job with empty progress", async () => {
    const id = await createJob(db, { brief: { prompt: "test", targetSeconds: 20, tone: "calm" }, seed: 1 });
    const row = await getJob(db, id);
    expect(row?.status).toBe("pending");
    expect(row?.completedStages).toEqual([]);
    expect(row?.plan).toBeNull();
  });

  it("records stage completion incrementally, in order", async () => {
    const id = await createJob(db, { brief: { prompt: "test", targetSeconds: 20, tone: "calm" }, seed: 2 });
    await markRunning(db, id);

    await recordStageCompletion(db, id, "script", { planVersion: 1, seed: 2, script: { hook: "h" } }, []);
    let row = await getJob(db, id);
    expect(row?.completedStages).toEqual(["script"]);

    await recordStageCompletion(
      db,
      id,
      "voice",
      { planVersion: 1, seed: 2, script: { hook: "h" }, voice: { id: "v" } },
      ["script"],
    );
    row = await getJob(db, id);
    expect(row?.completedStages).toEqual(["script", "voice"]);
    expect(row?.plan).toMatchObject({ voice: { id: "v" } });
  });

  it("marks a job done with its video path, and failed with its error", async () => {
    const doneId = await createJob(db, { brief: { prompt: "a", targetSeconds: 10, tone: "calm" }, seed: 3 });
    await markDone(db, doneId, "/tmp/output.mp4");
    expect((await getJob(db, doneId))?.status).toBe("done");
    expect((await getJob(db, doneId))?.videoPath).toBe("/tmp/output.mp4");

    const failedId = await createJob(db, { brief: { prompt: "a", targetSeconds: 10, tone: "calm" }, seed: 4 });
    await markFailed(db, failedId, "ffmpeg exited 1");
    expect((await getJob(db, failedId))?.status).toBe("failed");
    expect((await getJob(db, failedId))?.errorMessage).toBe("ffmpeg exited 1");
  });

  it("lists jobs by status", async () => {
    const pendingId = await createJob(db, { brief: { prompt: "a", targetSeconds: 10, tone: "calm" }, seed: 5 });
    const pending = await listJobsByStatus(db, "pending");
    expect(pending.some((j) => j.id === pendingId)).toBe(true);
  });
});
