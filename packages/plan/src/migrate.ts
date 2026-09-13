/**
 * planVersion N -> N+1.
 *
 * A plan is a stored, exportable, shareable document. A plan written today
 * must still render after the schema moves, which is why this file exists
 * from the first commit even though there is, at v1, exactly one version to
 * migrate to.
 */
import { CURRENT_PLAN_VERSION, PlanSchema, type Plan } from "./schema.js";

interface Migration {
  readonly from: number;
  readonly to: number;
  /** Transforms a plan-shaped object at version `from` into one at version `to`. */
  readonly migrate: (plan: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Ordered migration steps, oldest first. Empty at v1 by definition — there is
 * nothing older to migrate from yet.
 *
 * When planVersion 2 is introduced: add a step here
 * (`{ from: 1, to: 2, migrate: (plan) => ({ ...plan, planVersion: 2, ... }) }`),
 * raise `CURRENT_PLAN_VERSION` in `schema.ts`, and keep this array in order.
 */
const MIGRATIONS: readonly Migration[] = [];

class PlanVersionError extends Error {}

function readPlanVersion(rawPlan: unknown): number {
  if (typeof rawPlan !== "object" || rawPlan === null || Array.isArray(rawPlan)) {
    throw new PlanVersionError("not a plan document: expected a JSON object");
  }
  const version = (rawPlan as Record<string, unknown>)["planVersion"];
  if (typeof version !== "number" || !Number.isInteger(version)) {
    throw new PlanVersionError(
      `not a plan document: "planVersion" must be an integer, got ${JSON.stringify(version)}`,
    );
  }
  return version;
}

/**
 * Migrates a raw, untrusted plan-shaped value forward to `CURRENT_PLAN_VERSION`
 * and validates the result. Throws if no migration path exists, or if the
 * plan is newer than this build understands.
 */
export function migrate(rawPlan: unknown): Plan {
  let version = readPlanVersion(rawPlan);

  if (version > CURRENT_PLAN_VERSION) {
    throw new PlanVersionError(
      `plan is from planVersion ${version}, which is newer than this build supports (${CURRENT_PLAN_VERSION})`,
    );
  }

  let candidate = rawPlan as Record<string, unknown>;
  while (version < CURRENT_PLAN_VERSION) {
    const step = MIGRATIONS.find((m) => m.from === version);
    if (!step) {
      throw new PlanVersionError(
        `no migration path from planVersion ${version} to ${CURRENT_PLAN_VERSION}`,
      );
    }
    candidate = step.migrate(candidate);
    version = step.to;
  }

  return PlanSchema.parse(candidate);
}

export { PlanVersionError };
