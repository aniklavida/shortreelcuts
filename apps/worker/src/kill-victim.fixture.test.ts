import { test } from "vitest";
import { connect } from "@shortreelcuts/db";
import { runJob } from "./run.js";
import { runScript, runVoice, runAlign } from "@shortreelcuts/stages";
import { existsSync } from "node:fs";

test("victim", async () => {
  const jobId = process.env.VICTIM_JOB_ID;
  const sentinel = process.env.VICTIM_SENTINEL;
  const dbUrl = process.env.SHORTREELCUTS_DATABASE_URL;
  if (!jobId || !sentinel || !dbUrl) throw new Error("Missing env vars");

  const db = connect(dbUrl);
  try {
    await runJob(db, process.env.VICTIM_WORKDIR || "/tmp", {
      script: runScript,
      voice: runVoice,
      footage: async (input) => {
        // Block partway through the stage so parent can catch it
        while (!existsSync(sentinel)) {
          await new Promise(r => setTimeout(r, 100));
        }
        return { patch: { footage: {} as any }, candidates: {} };
      },
      align: runAlign,
      compose: async () => ({ patch: { captions: [], music: null, format: "9:16" } as any, candidates: {}, video: { path: "x", captionsPath: "x", width: 1, height: 1, fps: 1, durationSeconds: 1 } })
    }, jobId);
  } finally {
    await db.close();
  }
}, 30000);
