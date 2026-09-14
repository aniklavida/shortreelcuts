/**
 * The worker process entry point: connect, migrate, resume whatever was
 * left incomplete by a previous run, then subscribe to the queue for new
 * jobs. Reads its configuration from the environment because this file —
 * unlike everything it calls — is the one place in this package that is
 * allowed to know a database connection string exists.
 *
 * Not wired into a container image or a compose file here — that is the
 * self-hosting packaging this repository has not built yet. Running this
 * script directly (`node --experimental-strip-types src/start.ts`, or any
 * TypeScript runner) against a real Postgres is the whole of what it
 * needs.
 */
import { connect, runMigrations } from "@shortreelcuts/db";
import { resumeIncompleteJobs } from "./resume.js";
import { runJob } from "./run.js";
import { defaultRunners } from "./runners.js";
import { startQueue, workRenderQueue } from "./queue.js";

async function main(): Promise<void> {
  const connectionString = process.env["SHORTREELCUTS_DATABASE_URL"];
  if (!connectionString) {
    throw new Error("SHORTREELCUTS_DATABASE_URL is not set");
  }
  const workDir = process.env["SHORTREELCUTS_WORKER_WORKDIR"] ?? "./.shortreelcuts/work";

  const db = connect(connectionString);
  await runMigrations(db.pool);

  const runners = defaultRunners();

  const resumed = await resumeIncompleteJobs(db, workDir, runners);
  if (resumed.length > 0) {
      console.log(`[worker] resumed ${resumed.length} incomplete job(s) from the last run`);
  }

  const boss = await startQueue(connectionString);
  await workRenderQueue(boss, (jobId) => runJob(db, workDir, runners, jobId));

  console.log("[worker] ready");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
      console.error("[worker] fatal", err);
    process.exit(1);
  });
}
