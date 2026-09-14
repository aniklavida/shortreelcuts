/**
 * The jobs repository — every read and write `apps/worker` needs to make
 * a render resumable. Nothing here runs a stage; this module only
 * persists what has already happened, which is the whole point: the
 * worker can crash between any two of these calls and lose nothing more
 * than the one stage that was in flight.
 */
import { randomUUID } from "node:crypto";
import type { Stage } from "@shortreelcuts/plan";
import { eq } from "drizzle-orm";
import type { Database } from "./client.js";
import { jobs, type JobRow, type JobStatus } from "./schema.js";

export interface JobInput {
  readonly brief: unknown;
  readonly seed: number;
}

/** Inserts a new job in `pending` status with no completed stages. Returns the generated id. */
export async function createJob(db: Database, input: JobInput): Promise<string> {
  const id = randomUUID();
  await db.drizzle.insert(jobs).values({
    id,
    status: "pending",
    input,
    plan: null,
    completedStages: [],
  });
  return id;
}

export async function getJob(db: Database, id: string): Promise<JobRow | undefined> {
  const rows = await db.drizzle.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  return rows[0];
}

export async function listJobsByStatus(db: Database, status: JobStatus): Promise<readonly JobRow[]> {
  return db.drizzle.select().from(jobs).where(eq(jobs.status, status));
}

export async function markRunning(db: Database, id: string): Promise<void> {
  await db.drizzle.update(jobs).set({ status: "running", updatedAt: new Date() }).where(eq(jobs.id, id));
}

/**
 * Persists that `stage` just completed: the merged plan-so-far, and
 * `stage` appended to `completedStages`. Called once per stage, right
 * after that stage's patch is merged in and before the next stage
 * starts — so a crash immediately afterward still resumes correctly.
 */
export async function recordStageCompletion(
  db: Database,
  id: string,
  stage: Stage,
  planSoFar: unknown,
  previouslyCompleted: readonly Stage[],
): Promise<void> {
  await db.drizzle
    .update(jobs)
    .set({
      plan: planSoFar,
      completedStages: [...previouslyCompleted, stage],
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, id));
}

export async function markDone(db: Database, id: string, videoPath: string): Promise<void> {
  await db.drizzle
    .update(jobs)
    .set({ status: "done", videoPath, updatedAt: new Date() })
    .where(eq(jobs.id, id));
}

export async function markFailed(db: Database, id: string, errorMessage: string): Promise<void> {
  await db.drizzle
    .update(jobs)
    .set({ status: "failed", errorMessage, updatedAt: new Date() })
    .where(eq(jobs.id, id));
}
