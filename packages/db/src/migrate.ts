/**
 * A minimal migration runner: applies the `.sql` files in `migrations/`,
 * in filename order, that a `_migrations` tracking table says have not
 * run yet. Each file runs inside its own transaction.
 *
 * This is intentionally not a framework. One self-hoster runs one
 * instance against one database; a hand-rolled ten-line runner over
 * numbered SQL files is easier to audit than adding a migration-tool
 * dependency for a job that is this small.
 */
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

async function ensureTrackingTable(pool: Pool): Promise<void> {
  await pool.query(`
    create table if not exists _migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    );
  `);
}

async function appliedMigrations(pool: Pool): Promise<Set<string>> {
  const { rows } = await pool.query<{ name: string }>("select name from _migrations");
  return new Set(rows.map((r) => r.name));
}

/** Applies every pending migration in `migrations/`, in filename order. Safe to call every time the worker starts — already-applied files are skipped. */
export async function runMigrations(pool: Pool): Promise<readonly string[]> {
  await ensureTrackingTable(pool);
  const applied = await appliedMigrations(pool);

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const newlyApplied: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into _migrations (name) values ($1)", [file]);
      await client.query("commit");
      newlyApplied.push(file);
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  return newlyApplied;
}
