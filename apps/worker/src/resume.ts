/**
 * Runs at worker startup: finds every job left `pending` or `running` —
 * the two statuses a job can be stuck in if the worker process died
 * mid-render — and resumes each one through `runJob`, which skips
 * whatever `completedStages` already covers.
 *
 * This is what makes "killing the worker mid-render and restarting it
 * resumes from the last completed stage rather than starting over"
 * (card done-when) true independent of pg-boss's own redelivery timing:
 * a job's row, not the queue message, is the source of truth for what
 * has already run.
 */
import { listJobsByStatus, type Database } from "@shortreelcuts/db";
import type { StageRunners } from "@shortreelcuts/stages";
import { type JobRunEvents, runJob } from "./run.js";

export async function resumeIncompleteJobs(
  db: Database,
  workDir: string,
  runners: StageRunners,
  events: JobRunEvents = {},
): Promise<readonly string[]> {
  const [pending, running] = await Promise.all([
    listJobsByStatus(db, "pending"),
    listJobsByStatus(db, "running"),
  ]);
  const jobIds = [...pending, ...running].map((row) => row.id);

  for (const jobId of jobIds) {
    await runJob(db, workDir, runners, jobId, events);
  }

  return jobIds;
}
