/**
 * The worker process entry point: connect, migrate, resume whatever was
 * left incomplete by a previous run, then subscribe to the queue for new
 * jobs. Reads its configuration from the environment because this file —
 * unlike everything it calls — is the one place in this package that is
 * allowed to know a database connection string exists.
 *
 * Not wired into a container image or a compose file here — that is the
 * self-hosting packaging this repository has not built yet, and no build
 * step exists for any package in this repository yet either, so this
 * file is not runnable by a plain `node` invocation the way it is
 * written (its sibling modules import each other by their eventual
 * compiled `.js` names, which `NodeNext` module resolution requires but
 * which do not exist as files yet). It runs correctly today only through
 * a TypeScript-aware runner or bundler — the same way every test in this
 * workspace already runs it, via `vitest`.
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
