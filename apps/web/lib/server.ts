/**
 * Server-side database and queue context for apps/web.
 *
 * Calls the existing job API seam from @shortreelcuts/worker and repository from
 * @shortreelcuts/db. Never touches tables directly or bypasses the worker API seam.
 */
import { connect, type Database } from "@shortreelcuts/db";
import { startQueue } from "@shortreelcuts/worker";
import type { PgBoss } from "pg-boss";

export interface ServerContext {
  readonly db: Database;
  readonly boss: PgBoss;
}

let activeContext: ServerContext | null = null;
let testContext: ServerContext | null = null;

export function setTestServerContext(context: ServerContext | null): void {
  testContext = context;
}

export async function getServerContext(): Promise<ServerContext> {
  if (testContext) {
    return testContext;
  }
  if (!activeContext) {
    const connectionString = process.env["SHORTREELCUTS_DATABASE_URL"];
    if (!connectionString) {
      throw new Error("SHORTREELCUTS_DATABASE_URL is not set");
    }
    const db = connect(connectionString);
    const boss = await startQueue(connectionString);
    activeContext = { db, boss };
  }
  return activeContext;
}
