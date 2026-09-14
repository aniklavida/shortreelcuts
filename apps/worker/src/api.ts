/**
 * The job API `docs/STRUCTURE.md` says the web app calls — `apps/web`
 * does not exist yet (see the private execution log), so this is that
 * seam without a Next.js route wrapped around it: two plain functions a
 * route handler, or a test, can call directly.
 *
 * Both are deliberately thin. `createJobAndEnqueue` never runs a stage —
 * it persists the job and hands it to the queue, so the HTTP request that
 * creates a render returns immediately (`docs/SPEC.md` §6 — "stages run
 * in a worker, not in a web request"). `getJobProgress` never touches the
 * worker process — it reads the same row `run.ts` writes, so "reattach
 * after a browser refresh" is just calling this again with the same id.
 */
import { createJob, getJob, type Database } from "@shortreelcuts/db";
import type { PgBoss } from "pg-boss";
import { enqueueRender } from "./queue.js";

export interface CreateJobInput {
  readonly brief: unknown;
  readonly seed: number;
}

export interface JobProgress {
  readonly id: string;
  readonly status: string;
  readonly completedStages: readonly string[];
  /** The plan as it stands after the most recently completed stage. `null` before `script` has run. */
  readonly plan: unknown;
  readonly videoPath: string | null;
  readonly errorMessage: string | null;
}

export async function createJobAndEnqueue(db: Database, boss: PgBoss, input: CreateJobInput): Promise<string> {
  const jobId = await createJob(db, input);
  await enqueueRender(boss, jobId);
  return jobId;
}

export async function getJobProgress(db: Database, jobId: string): Promise<JobProgress | undefined> {
  const row = await getJob(db, jobId);
  if (!row) return undefined;
  return {
    id: row.id,
    status: row.status,
    completedStages: (row.completedStages as string[] | null) ?? [],
    plan: row.plan,
    videoPath: row.videoPath,
    errorMessage: row.errorMessage,
  };
}
