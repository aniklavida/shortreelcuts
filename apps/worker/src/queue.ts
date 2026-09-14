/**
 * The queue a job travels through between being created and being run.
 * pg-boss runs on the same PostgreSQL `@shortreelcuts/db` already
 * connects to (`docs/SPEC.md` §14's dependency table) — no separate
 * queue service for a self-hoster to run and back up.
 */
import { PgBoss } from "pg-boss";

export const RENDER_QUEUE = "render-job";

export interface RenderJobData {
  readonly jobId: string;
}

export async function startQueue(connectionString: string): Promise<PgBoss> {
  const boss = new PgBoss(connectionString);
  boss.on("error", (err: unknown) => {
    console.error("[worker] queue error", err);
  });
  await boss.start();
  await boss.createQueue(RENDER_QUEUE);
  return boss;
}

export async function enqueueRender(boss: PgBoss, jobId: string): Promise<void> {
  await boss.send(RENDER_QUEUE, { jobId } satisfies RenderJobData);
}

/** Subscribes `handle` to every job sent to the render queue. `handle` receives just the job id — `run.ts`'s `runJob` re-reads the row itself, so the queue never carries plan state that could go stale between send and delivery. */
export async function workRenderQueue(boss: PgBoss, handle: (jobId: string) => Promise<void>): Promise<void> {
  await boss.work<RenderJobData>(RENDER_QUEUE, async (jobs) => {
    for (const job of jobs) {
      await handle(job.data.jobId);
    }
  });
}
