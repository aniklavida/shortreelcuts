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
 * The beat a leaf path belongs to, if it belongs to one beat in
 * particular — `footage.<id>...` and `align.words.<id>...` both name a
 * beat directly; `script.beats.<index>...` names one by array position,
 * resolved back to that beat's id. Every other path (the prompt, the
 * seed, `voice.*`, `align.provider`, `script.hook`, ...) applies to every
 * beat equally, and returns `undefined` here for exactly that reason.
 */
function beatScopeOf(path: string, plan: Plan): string | undefined {
  const segments = path.split(".");
  if (segments[0] === "footage" && segments.length >= 2) return segments[1];
  if (segments[0] === "align" && segments[1] === "words" && segments.length >= 3) return segments[2];
  if (segments[0] === "script" && segments[1] === "beats" && segments.length >= 3) {
    const index = Number(segments[2]);
    if (Number.isInteger(index)) return plan.script.beats[index]?.id;
  }
  return undefined;
}

/**
 * The plan leaf paths that feed a stage's artefact: every field owned by
 * that stage or by anything upstream of it. `planVersion` is excluded here
 * and folded into the key separately; reason strings and other
 * never-invalidating fields (see `ownerOf`) are excluded because they do
 * not affect what a stage would produce.
 *
 * `beatId`, given for `"footage"` or `"frames"` (the only two stages kept
 * per beat), narrows the result to that beat's own leaves plus every leaf
 * that applies to every beat equally
 * (the prompt, the voice, and so on) - so a per-beat key changes only when
 * something that beat's own render actually depends on changes. Throws for
 * any other stage: a per-beat key is meaningless for `script`, `voice`,
 * `align` or `compose`, which each produce one thing for the whole plan.
 *
 * Sorted, so the result does not depend on the plan object's key order.
 */
export function stageInputPaths(stage: Stage, plan: Plan, beatId?: string): string[] {
  const relevant = new Set<Stage>(upstreamOf(stage));
  let leaves = leavesOf(plan)
    .filter((leaf) => leaf.path !== "planVersion")
    .filter((leaf) => {
      const owner = ownerOf(leaf.path);
      return owner !== null && relevant.has(owner);
    });

  if (beatId !== undefined) {
    if (stage !== "footage" && stage !== "frames") {
      throw new Error(`a per-beat content key is only meaningful for "footage" or "frames", not "${stage}"`);
    }
    leaves = leaves.filter((leaf) => {
      const scope = beatScopeOf(leaf.path, plan);
      return scope === undefined || scope === beatId;
    });
  }

  return leaves.map((leaf) => leaf.path).sort();
}

/**
 * A stable content-addressed key for `stage`'s output, given `plan`.
 * Two plans that agree on every path `stageInputPaths` returns for this
 * stage always produce the same key, regardless of unrelated fields,
 * object key order, or whether the two plan objects are the same
 * reference - which is what makes an unchanged stage reusable rather than
 * recomputed.
 *
 * Pass `beatId` (only meaningful for `"footage"`/`"frames"`) for that
 * beat's own key, so an unchanged beat's clip can be reused by key while
 * only the beats a change actually touched re-render — see
 * `invalidateScoped` in `graph.ts` for the matching per-beat invalidation.
 */
export function contentKeyFor(stage: Stage, plan: Plan, beatId?: string): ArtifactKey {
  const leaves = new Map(leavesOf(plan).map((leaf) => [leaf.path, leaf.value] as const));
  const paths = stageInputPaths(stage, plan, beatId);
  const inputs = paths.map((path) => [path, leaves.get(path)] as const);

  const canonical = JSON.stringify({
    stage,
    planVersion: plan.planVersion,
    beatId: beatId ?? null,
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
