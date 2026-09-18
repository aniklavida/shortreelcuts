/**
 * Runs one job through the stage graph, resuming from whatever
 * `completedStages` in its row already says is done.
 *
 * This is `apps/worker/run.ts` from `docs/STRUCTURE.md`: the queued
 * counterpart to `packages/sheet`'s in-process `ProjectSession.generate()`
 * (see that file's own header) — the same `StageRunners` contract, the
 * same pipeline order from `@shortreelcuts/plan`'s `STAGES`, but backed by
 * a database row instead of an in-memory array, which is what survives a
 * killed process.
 *
 * The resumability guarantee this file exists for: after any stage
 * completes, its patch and its name are written to the row
 * (`recordStageCompletion`) *before* the next stage starts. If the
 * process dies at any point, the next call to `runJob` for the same job
 * id reads that row, skips every stage already in `completedStages`, and
 * runs only what is left — never re-running a completed stage, never
 * skipping one that never finished.
 */
import { getJob, markDone, markFailed, markRunning, recordStageCompletion, type Database } from "@shortreelcuts/db";
import { CURRENT_PLAN_VERSION, STAGES, type Plan, type Stage } from "@shortreelcuts/plan";
import type { StageRunners } from "@shortreelcuts/stages";

export interface JobRunEvents {
  onStageStart?(jobId: string, stage: Stage): void;
  onStageComplete?(jobId: string, stage: Stage, elapsedMs: number): void;
  /** Fired once, only when a stage was skipped because `completedStages` already had it — the visible proof that resumption, not a full re-run, happened. */
  onStageSkippedAlreadyDone?(jobId: string, stage: Stage): void;
}

export class JobNotFoundError extends Error {
  constructor(jobId: string) {
    super(`job ${jobId} not found`);
  }
}

async function runOneStage(
  runners: StageRunners,
  stage: Stage,
  draft: Record<string, unknown>,
  workDir: string,
): Promise<{ patch: Record<string, unknown>; candidates?: Record<string, unknown>; videoPath?: string }> {
  switch (stage) {
    case "script":
      return runners
        .script({ brief: draft["brief"] as Plan["brief"], seed: draft["seed"] as number })
        .then((r) => ({ patch: r.patch, candidates: r.candidates }));
    case "voice":
      return runners.voice({ plan: draft as Plan }).then((r) => ({ patch: r.patch, candidates: r.candidates }));
    case "footage":
      return runners.footage({ plan: draft as Plan }).then((r) => ({ patch: r.patch, candidates: r.candidates }));
    case "align":
      return runners.align({ plan: draft as Plan }).then((r) => ({ patch: r.patch, candidates: r.candidates }));
    case "compose":
      return runners.compose({ plan: draft as Plan, workDir }).then((r) => ({
        patch: r.patch,
        candidates: r.candidates,
        videoPath: r.video.path,
      }));
  }
}

/**
 * Executes `jobId` to completion, running only the stages its row does
 * not already list as completed. Safe to call again on a job that is
 * already partly (or fully) done — a fully completed job runs zero
 * stages and returns immediately.
 */
export async function runJob(
  db: Database,
  workDir: string,
  runners: StageRunners,
  jobId: string,
  events: JobRunEvents = {},
): Promise<void> {
  const row = await getJob(db, jobId);
  if (!row) throw new JobNotFoundError(jobId);

  await markRunning(db, jobId);

  const input = row.input as { brief: Plan["brief"]; seed: number };
  let draft: Record<string, unknown> = (row.plan as Record<string, unknown> | null) ?? {
    planVersion: CURRENT_PLAN_VERSION,
    seed: input.seed,
    brief: input.brief,
  };
  const completed: Stage[] = [...((row.completedStages as Stage[] | null) ?? [])];
  const completedSet = new Set(completed);
  let candidatesSoFar: Record<string, unknown> = (row.candidates as Record<string, unknown> | null) ?? {};

  try {
    for (const stage of STAGES) {
      if (completedSet.has(stage)) {
        events.onStageSkippedAlreadyDone?.(jobId, stage);
        continue;
      }

      events.onStageStart?.(jobId, stage);
      const start = Date.now();
      const { patch, candidates, videoPath } = await runOneStage(runners, stage, draft, workDir);
      draft = { ...draft, ...patch };
      if (candidates) {
        candidatesSoFar = { ...candidatesSoFar, ...candidates };
      }
      events.onStageComplete?.(jobId, stage, Date.now() - start);

      // Written before the next stage starts — see this file's header.
      await recordStageCompletion(db, jobId, stage, draft, completed, candidatesSoFar);
      completed.push(stage);
      completedSet.add(stage);

      if (stage === "compose" && videoPath) {
        await markDone(db, jobId, videoPath);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(db, jobId, message);
    throw err;
  }
}
