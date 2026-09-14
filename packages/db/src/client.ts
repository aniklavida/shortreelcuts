/**
 * The Postgres connection — one `pg.Pool`, wrapped by Drizzle for typed
 * queries. `@shortreelcuts/db` never reads `process.env` itself; the
 * caller (the worker) decides the connection string, so this package
 * stays usable from a test with a throwaway database.
 */
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export interface Database {
  readonly pool: Pool;
  readonly drizzle: NodePgDatabase<typeof schema>;
  close(): Promise<void>;
}

export function connect(connectionString: string): Database {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return {
    pool,
    drizzle: db,
    close: () => pool.end(),
  };
}
