/**
 * The stage dependency graph.
 *
 * The most load-bearing code in the repository, because the dependency
 * graph is the feature (`docs/SPEC.md` §6): given the plan paths a change
 * touched, `invalidate` returns exactly the stages that must re-run - and
 * no others. Getting this wrong either re-runs too much (an unexpected
 * wait and bill) or too little (a silently wrong video).
 *
 * No stage is implemented here or anywhere yet. `Stage` is an identifier;
 * this module only reasons about the shape of the pipeline, never runs it.
 */
import { STAGES, type Stage } from "./schema.js";

export { STAGES };
export type { Stage };

/**
 * `[from, to]` means `to` consumes something `from` produced, so `to` must
 * re-run whenever `from` does. This is exactly the diagram in
 * AGENTS.md / docs/ARCHITECTURE.md:
 *
 *   script ──┬──▶ voice ──▶ align ──┐
 *            └──▶ footage ──────────┴──▶ compose
 */
const EDGES: ReadonlyArray<readonly [Stage, Stage]> = [
  ["script", "voice"],
  ["script", "footage"],
  ["voice", "align"],
  ["align", "compose"],
  ["footage", "compose"],
];

function closure(
  start: Stage,
  edgesFrom: (stage: Stage) => readonly Stage[],
): Stage[] {
  const seen = new Set<Stage>([start]);
  const queue: Stage[] = [start];
  while (queue.length > 0) {
    const current = queue.shift() as Stage;
    for (const next of edgesFrom(current)) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  // Stable, pipeline-order output regardless of traversal order.
  return STAGES.filter((stage) => seen.has(stage));
}

function forwardNeighbours(stage: Stage): Stage[] {
  return EDGES.filter(([from]) => from === stage).map(([, to]) => to);
}

function backwardNeighbours(stage: Stage): Stage[] {
  return EDGES.filter(([, to]) => to === stage).map(([from]) => from);
}

/** `stage` plus every stage downstream of it (that consumes it, directly or transitively). */
export function downstreamOf(stage: Stage): readonly Stage[] {
  return closure(stage, forwardNeighbours);
}

/** `stage` plus every stage upstream of it (that it consumes, directly or transitively). */
export function upstreamOf(stage: Stage): readonly Stage[] {
  return closure(stage, backwardNeighbours);
}

type Owner = Stage | null;

interface ExactRule {
  readonly kind: "exact";
  readonly segments: readonly string[];
  readonly owner: Owner;
}

interface PrefixRule {
  readonly kind: "prefix";
  readonly segments: readonly string[];
  readonly owner: Owner;
}

type Rule = ExactRule | PrefixRule;

function exact(pattern: string, owner: Owner): ExactRule {
  return { kind: "exact", segments: pattern.split("."), owner };
}

function prefix(pattern: string, owner: Owner): PrefixRule {
  return { kind: "prefix", segments: pattern.split("."), owner };
}

/**
 * Field-level exceptions, checked before the whole-namespace rules below.
 * `*` matches exactly one path segment (e.g. a beat id, or an array index).
 *
 * These exist because "footage" and "script" are not owned by a single
 * stage end to end - the re-run table in `docs/SPEC.md` §6 requires that
 * swapping a clip (footage.<id>.assetId/in/out) costs only a re-compose,
 * while a new search term (script.beats.<i>.search) costs a re-fetch,
 * even though both live under a beat.
 */
const FIELD_RULES: readonly Rule[] = [
  // A hand-edited script line is spoken text - it changes the voiceover,
  // not the search or the on-screen overlay for that beat.
  exact("script.hook", "voice"),
  exact("script.beats.*.narration", "voice"),
  // On-screen overlay text is a compose-time decision: it is burned in
  // alongside the captions and does not require re-synthesising audio.
  exact("script.beats.*.onScreen", "compose"),
  // The search term is what the footage stage sends to its provider.
  exact("script.beats.*.search", "footage"),
  // A beat's identity is structural. Treated conservatively: full re-run.
  exact("script.beats.*.id", "script"),

  // Picking a different already-fetched candidate, or trimming it, is a
  // compose-only change - no new provider call is needed.
  exact("footage.*.assetId", "compose"),
  exact("footage.*.in", "compose"),
  exact("footage.*.out", "compose"),
  // Changing which provider supplies a beat's footage needs a re-fetch.
  exact("footage.*.provider", "footage"),
];

/**
 * Whole-namespace ownership, at any depth, for the sections that are not
 * subdivided above. Checked after `FIELD_RULES`, and also serves as the
 * fallback for any part of `script` or `footage` the field rules above do
 * not name explicitly (e.g. replacing a whole beat or a whole clip) - the
 * conservative default there is the stage that owns the namespace, which
 * is always a superset of what a more specific rule would have chosen.
 */
const NAMESPACE_RULES: readonly Rule[] = [
  prefix("seed", "script"),
  prefix("brief", "script"),
  prefix("script", "script"),
  prefix("voice", "voice"),
  prefix("footage", "footage"),
  prefix("align", "align"),
  prefix("captions", "compose"),
  prefix("music", "compose"),
  prefix("format", "compose"),
];

const RULES: readonly Rule[] = [...FIELD_RULES, ...NAMESPACE_RULES];

function matches(pathSegments: readonly string[], rule: Rule): boolean {
  if (rule.kind === "exact") {
    if (pathSegments.length !== rule.segments.length) return false;
  } else if (pathSegments.length < rule.segments.length) {
    return false;
  }
  return rule.segments.every((segment, i) => segment === "*" || segment === pathSegments[i]);
}

/**
 * The stage that owns a plan path — the stage that must re-run when that
 * exact field changes, before its own downstream stages are added by
 * `invalidate`. Returns `null` for paths that never require a re-run:
 *
 * - `planVersion` is a document-version marker, handled by `migrate.ts`,
 *   not a production decision.
 * - Any path ending in `reason` is the explanation text a stage recorded
 *   for a decision it already made. It is read by the decision sheet, not
 *   by any stage, so changing it changes nothing about the output.
 *
 * An unrecognised path (a field this function does not yet know about)
 * conservatively owns `"script"`, the root of the graph, so an unhandled
 * case re-runs too much rather than too little.
 */
export function ownerOf(path: string): Owner {
  if (path === "planVersion") return null;
  const segments = path.split(".");
  if (segments[segments.length - 1] === "reason") return null;

  for (const rule of RULES) {
    if (matches(segments, rule)) return rule.owner;
  }
  return "script";
}

/**
 * Given the plan paths a change touched, returns exactly the stages that
 * must re-run, in pipeline order. A path whose owner is `null` contributes
 * nothing. An empty input returns an empty output.
 */
export function invalidate(changedPaths: readonly string[]): Stage[] {
  const toRerun = new Set<Stage>();
  for (const path of changedPaths) {
    const owner = ownerOf(path);
    if (owner === null) continue;
    for (const stage of downstreamOf(owner)) {
      toRerun.add(stage);
    }
  }
  return STAGES.filter((stage) => toRerun.has(stage));
}
