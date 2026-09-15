/**
 * What an override is expected to cost, computed from the stage set
 * `invalidate()` returns — before any stage runs.
 *
 * `docs/SPEC.md` §6's table is explicitly "a target for v1, not a measured
 * result", because no real provider exists to measure yet — §11 settles
 * *which* model the script and voice stages will run against (whatever
 * the user connects — hosted key, subscription, or local), not what it
 * costs in wall-clock time. These numbers are the same kind of placeholder: a deterministic, disclosed heuristic
 * good enough to prove the *mechanism* — a cost shown before a change is
 * applied — not a benchmark. Recalibrate this table, not the mechanism,
 * once real stages exist.
 */
import type { Stage } from "@shortreelcuts/plan";

export interface StageCost {
  readonly seconds: number;
  /** What this stage re-running means to a person, in plain language, fragment-shaped ("regenerates the voiceover"). */
  readonly does: string;
}

export const STAGE_COST: Readonly<Record<Stage, StageCost>> = {
  script: { seconds: 22, does: "rewrites the script" },
  voice: { seconds: 18, does: "regenerates the voiceover" },
  footage: { seconds: 6, does: "looks up new footage" },
  align: { seconds: 3, does: "re-times the captions" },
  // No runner exists yet — this is the same disclosed-placeholder heuristic
  // the rest of this table already is, sized like a local render (no
  // provider round trip) since that is what `frames` will be once it exists.
  frames: { seconds: 5, does: "renders the animation frames" },
  compose: { seconds: 4, does: "re-renders the video" },
};

export interface CostEstimate {
  readonly stages: readonly Stage[];
  readonly totalSeconds: number;
  /** e.g. "Regenerates the voiceover — about 30 seconds". Empty stages produce "Nothing to re-run". */
  readonly headline: string;
  /** e.g. "voice → align → compose". Empty when `stages` is empty. */
  readonly path: string;
}

function roundToFive(seconds: number): number {
  return Math.max(1, Math.round(seconds / 5) * 5);
}

/**
 * Sums the declared cost of every stage in `stages` and phrases a
 * one-line headline from the most upstream (and so most expensive) one —
 * matching the examples `docs/SPEC.md` §8 gives for an override's stated
 * cost: *"Re-renders in about 4 seconds"*, *"Regenerates the voiceover —
 * about 30 seconds"*.
 */
export function estimateRerun(stages: readonly Stage[]): CostEstimate {
  if (stages.length === 0) {
    return { stages: [], totalSeconds: 0, headline: "Nothing to re-run", path: "" };
  }

  const totalSeconds = stages.reduce((sum, s) => sum + STAGE_COST[s].seconds, 0);
  const lead = STAGE_COST[stages[0] as Stage];
  const rounded = roundToFive(totalSeconds);

  const headline =
    stages.length === 1 && stages[0] === "compose"
      ? `Re-renders in about ${rounded} seconds`
      : `${lead.does[0]?.toUpperCase()}${lead.does.slice(1)} — about ${rounded} seconds`;

  return { stages, totalSeconds: rounded, headline, path: stages.join(" → ") };
}
