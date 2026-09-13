/**
 * Content-addressed artefact keys.
 *
 * `invalidate()` in graph.ts answers "given what changed, which stages
 * must re-run" from a diff. This file answers a complementary question,
 * for a stage runner that is not built yet: "have I already produced
 * this stage's output for exactly these inputs?" If two plans agree on
 * everything a stage depends on, that stage's artefact key is identical,
 * and its previous output can be reused instead of recomputed.
 *
 * No cache or store is implemented here, and nothing in this repository
 * keeps stage outputs keyed by one yet. This is the pure key function on
 * its own; the store that would make reuse real is not built.
 */
import { createHash } from "node:crypto";
import { STAGES, upstreamOf, ownerOf, type Stage } from "./graph.js";
import { leavesOf } from "./paths.js";
import type { Plan } from "./schema.js";

export { STAGES };

/** An opaque, stable identifier for one stage's output given one plan. */
export type ArtifactKey = string;

/**
 * The plan leaf paths that feed a stage's artefact: every field owned by
 * that stage or by anything upstream of it. `planVersion` is excluded here
 * and folded into the key separately; reason strings and other
 * never-invalidating fields (see `ownerOf`) are excluded because they do
 * not affect what a stage would produce.
 *
 * Sorted, so the result does not depend on the plan object's key order.
 */
export function stageInputPaths(stage: Stage, plan: Plan): string[] {
  const relevant = new Set<Stage>(upstreamOf(stage));
  return leavesOf(plan)
    .filter((leaf) => leaf.path !== "planVersion")
    .filter((leaf) => {
      const owner = ownerOf(leaf.path);
      return owner !== null && relevant.has(owner);
    })
    .map((leaf) => leaf.path)
    .sort();
}

/**
 * A stable content-addressed key for `stage`'s output, given `plan`.
 * Two plans that agree on every path `stageInputPaths` returns for this
 * stage always produce the same key, regardless of unrelated fields,
 * object key order, or whether the two plan objects are the same
 * reference - which is what makes an unchanged stage reusable rather than
 * recomputed.
 */
export function contentKeyFor(stage: Stage, plan: Plan): ArtifactKey {
  const leaves = new Map(leavesOf(plan).map((leaf) => [leaf.path, leaf.value] as const));
  const paths = stageInputPaths(stage, plan);
  const inputs = paths.map((path) => [path, leaves.get(path)] as const);

  const canonical = JSON.stringify({
    stage,
    planVersion: plan.planVersion,
    inputs,
  });

  const digest = createHash("sha256").update(canonical).digest("hex");
  return `sha256:${digest}`;
}

/** The artefact key for every stage, in pipeline order. Convenience over calling `contentKeyFor` five times. */
export function contentKeysFor(plan: Plan): Record<Stage, ArtifactKey> {
  return Object.fromEntries(STAGES.map((stage) => [stage, contentKeyFor(stage, plan)])) as Record<
    Stage,
    ArtifactKey
  >;
}
