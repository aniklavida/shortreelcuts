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
 * `planVersion` 1 → 2: `footage.<id>` becomes a discriminated union across
 * three sources (`docs/SPEC.md` §11). Every `planVersion` 1 clip only ever
 * meant one of them — a stock clip, `{provider, assetId, in, out, reason}`
 * — so the migration is a reshape, not a redesign:
 * `source: "stock"` is added, and a `credit` object is synthesized because
 * v1 never recorded one (nothing in that plan shape carried a creator or a
 * page to attribute). A migrated clip's credit is honestly a placeholder,
 * not a real one — there was nothing to recover it from.
 */
function migrateFootageV1toV2(footage: Record<string, unknown>): Record<string, unknown> {
  const migrated: Record<string, unknown> = {};
  for (const [beatId, rawClip] of Object.entries(footage)) {
    const clip = rawClip as Record<string, unknown>;
    migrated[beatId] = {
      source: "stock",
      provider: clip["provider"],
      assetId: clip["assetId"],
      in: clip["in"],
      out: clip["out"],
      credit: { creator: "unknown", pageUrl: "https://unknown.invalid/" },
      reason: clip["reason"],
    };
  }
  return migrated;
}

/**
 * Ordered migration steps, oldest first.
 *
 * When a future planVersion is introduced: add a step here in the same
 * shape, raise `CURRENT_PLAN_VERSION` in `schema.ts`, and keep this array
 * in order.
 */
const MIGRATIONS: readonly Migration[] = [
  {
    from: 1,
    to: 2,
    migrate: (plan) => ({
      ...plan,
      planVersion: 2,
      footage: migrateFootageV1toV2(plan["footage"] as Record<string, unknown>),
    }),
  },
];

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
