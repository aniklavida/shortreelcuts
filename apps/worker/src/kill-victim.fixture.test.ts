/**
 * The victim process for the killed-worker resumability test in
 * `run.e2e.test.ts` — not a test of its own.
 *
 * `runJob` cannot be killed convincingly from inside the process running
 * it, so that test spawns this file in a real, detached child process and
 * sends the whole process group a `SIGKILL` once the job's row shows the
 * expected partial progress. This file therefore runs the *real* `runJob`
 * against the *real* database; only the blocking stage is arranged, so the
 * parent has a window in which to kill it.
 *
 * It parks in `footage` until a sentinel file appears. The parent never
 * creates that sentinel — the block is released by the kill, which is the
 * point: nothing here ever runs a catch block or a graceful shutdown, just
 * as a real `kill -9` would not.
 *
 * Skipped unless the parent passes `VICTIM_JOB_ID`, so a plain `npm test`
 * — which has no database and no job — collects this file and runs nothing.
 */
import { test } from "vitest";
import { connect } from "@shortreelcuts/db";
import { existsSync } from "node:fs";
import { runAlign, runScript, runVoice } from "@shortreelcuts/stages";
import type { ComposeRunResult, FootagePlan, Plan } from "@shortreelcuts/stages";
import { runJob } from "./run.js";

const jobId = process.env["VICTIM_JOB_ID"];
const sentinel = process.env["VICTIM_SENTINEL"];
const dbUrl = process.env["SHORTREELCUTS_DATABASE_URL"];

test.skipIf(!jobId || !sentinel || !dbUrl)("victim", async () => {
  const db = connect(dbUrl as string);
  try {
    await runJob(
      db,
      process.env["VICTIM_WORKDIR"] ?? "/tmp",
      {
        script: runScript,
        voice: runVoice,
        // Parks here until killed — see this file's header.
        footage: async () => {
          while (!existsSync(sentinel as string)) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          return { patch: { footage: {} as FootagePlan }, candidates: {} };
        },
        align: runAlign,
        // Never reached: the parent kills this process while `footage` is parked.
        compose: (input): Promise<ComposeRunResult> =>
          Promise.resolve({
            patch: {
              captions: input.plan.captions,
              music: input.plan.music,
              format: input.plan.format,
            } as Pick<Plan, "captions" | "music" | "format">,
            candidates: {},
            video: {
              path: `${input.workDir}/output.mp4`,
              captionsPath: `${input.workDir}/output.mp4.srt`,
              width: 1080,
              height: 1920,
              fps: 30,
              durationSeconds: 12,
            },
          }),
      },
      jobId as string,
    );
  } finally {
    await db.close();
  }
}, 30000);
