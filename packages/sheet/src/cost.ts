/**
 * What an override is expected to cost, computed from the stage set
 * `invalidate()` returns — before any stage runs.
 *
 * `docs/SPEC.md` §6's table is explicitly "a target for v1, not a measured
 * result", because no real provider exists to measure yet — which script
 * and voice providers v1 ships against is still open (§13). These numbers
 * are the same kind of placeholder: a deterministic, disclosed heuristic
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
 * matching the card's own examples: *"Re-renders in about 4 seconds"*,
 * *"Regenerates the voiceover — about 30 seconds"*.
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
