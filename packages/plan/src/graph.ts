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
import type { Plan } from "./schema.js";
import { STAGES, type Stage } from "./schema.js";

export { STAGES };
export type { Stage };

/**
 * `[from, to]` means `to` consumes something `from` produced, so `to` must
 * re-run whenever `from` does. `frames` (`docs/SPEC.md` §6) sits between
 * `footage`/`align` and `compose`, normalising every beat's footage
 * decision (a trimmed stock clip, a generated clip, or a rendered motion
 * scene) into one clip before compose ever sees it. `footage → compose`
 * and `align → compose` are replaced by the path through `frames`.
 *
 *   script ──┬──▶ voice ──▶ align ──┐
 *            └──▶ footage ──────────┴──▶ frames ──▶ compose
 */
const EDGES: ReadonlyArray<readonly [Stage, Stage]> = [
  ["script", "voice"],
  ["script", "footage"],
  ["voice", "align"],
  ["align", "frames"],
  ["footage", "frames"],
  ["frames", "compose"],
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
 * swapping a clip (footage.<id>.assetId/in/out) costs only a re-render of
 * that beat's normalised clip, while a new search term
 * (script.beats.<i>.search) costs a re-fetch, even though both live under
 * a beat.
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

  // Footage: additions for the three-source union (`docs/SPEC.md` §11).
  // Which source a beat uses is a footage-stage decision either way.
  exact("footage.*.source", "footage"),

  // Stock: picking a different already-fetched candidate, or trimming it,
  // is now `frames`'s job (that beat's normalised clip is re-rendered) -
  // not `compose` directly, now that `frames` sits between them, and not
  // `footage` - no new provider call is needed.
  exact("footage.*.assetId", "frames"),
  exact("footage.*.in", "frames"),
  exact("footage.*.out", "frames"),
  // Changing which provider supplies a beat's footage needs a re-fetch.
  exact("footage.*.provider", "footage"),
  // Attribution, recorded once a clip is chosen. Never re-fetched over.
  prefix("footage.*.credit", null),

  // Generated: everything that changes what gets generated needs a new
  // provider job - a re-render never re-submits it (`output` is the stored
  // result, not a fresh request).
  exact("footage.*.prompt", "footage"),
  exact("footage.*.model", "footage"),
  exact("footage.*.seconds", "footage"),
  prefix("footage.*.output", null),

  // Motion: the scene itself - template params or hand-edited code - is a
  // local, free re-render in `frames`, never a new model call. Asking the
  // model to rewrite the scene is a UI action that runs `footage` directly
  // and produces a new `scene` value; the path-diff rule below only has to
  // cover what re-deriving from that new value costs, which is `frames`
  // either way.
  prefix("footage.*.scene", "frames"),
  exact("footage.*.captionsInScene", "frames"),
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
  // Render metadata (`schema.ts`'s `RenderMetadataSchema`) records what a
  // fresh `frames` run used - never a decision, never re-run over.
  prefix("render", null),
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

/** `"all"`, or exactly the beats a stage must re-run for. */
export type ScopedBeats = "all" | ReadonlySet<string>;

export interface ScopedInvalidation {
  readonly stage: Stage;
  readonly beats: ScopedBeats;
}

/**
 * `footage.<beatId>...` is the only plan path that literally names one
 * beat's own footage decision - `footage`/`frames` are the only two
 * stages `invalidateScoped` ever narrows below "every beat" (see below),
 * so this is the one place that narrowing needs to read a beat id back out
 * of a path.
 */
function footageBeatIdOf(path: string): string | undefined {
  const segments = path.split(".");
  return segments[0] === "footage" ? segments[1] : undefined;
}

/**
 * Re-rendering every beat's animation because one beat's text changed
 * would make a six-beat video's cheapest motion edit six times slower
 * than it needs to be. `invalidate()` above answers "which stages",
 * coarsely, and is kept exactly as it was (its own tests are kept too -
 * nothing here changes what it returns). This answers the same question
 * at beat granularity, but only for `footage` and `frames`, the two
 * stages that are actually keyed per beat:
 *
 * - A change that names one beat's footage field (`footage.<id>.*`)
 *   narrows `footage` and `frames` to that beat alone.
 * - A voice or align change moves timing for every *motion* beat's frames
 *   (its on-screen duration comes from the aligned narration) but touches
 *   no stock or generated beat's `frames` output, so those are left out
 *   entirely.
 * - Anything else that reaches `footage`/`frames` (a script-level change,
 *   the prompt, the seed) is conservative: every beat.
 *
 * Every other stage is never beat-scoped here - `script`, `voice`,
 * `align` and `compose` each produce one thing for the whole plan, not
 * one per beat, so "all" is the only meaningful answer for them.
 */
export function invalidateScoped(changedPaths: readonly string[], plan: Plan): ScopedInvalidation[] {
  const acc = new Map<Stage, ScopedBeats>();

  const addAll = (stage: Stage): void => {
    acc.set(stage, "all");
  };
  const addBeats = (stage: Stage, beatIds: Iterable<string>): void => {
    const existing = acc.get(stage);
    if (existing === "all") return;
    const merged = new Set<string>(existing);
    for (const beatId of beatIds) merged.add(beatId);
    acc.set(stage, merged);
  };
  const motionBeatIds = (): string[] =>
    plan.script.beats.filter((beat) => plan.footage[beat.id]?.source === "motion").map((beat) => beat.id);

  for (const path of changedPaths) {
    const owner = ownerOf(path);
    if (owner === null) continue;
    const footageBeatId = footageBeatIdOf(path);

    for (const stage of downstreamOf(owner)) {
      if (stage !== "footage" && stage !== "frames") {
        addAll(stage);
        continue;
      }
      if (footageBeatId !== undefined && (owner === "footage" || owner === "frames")) {
        addBeats(stage, [footageBeatId]);
      } else if (stage === "frames" && (owner === "voice" || owner === "align")) {
        addBeats(stage, motionBeatIds());
      } else {
        addAll(stage);
      }
    }
  }

  return STAGES.filter((stage) => acc.has(stage)).map((stage) => ({ stage, beats: acc.get(stage) as ScopedBeats }));
}
