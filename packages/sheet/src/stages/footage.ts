/**
 * The footage stage — stubbed.
 *
 * Neither footage provider named in SPEC.md §5.2 is implemented, and the
 * decision between them is still open. This stub proposes several
 * candidate clips per beat and picks one, so the sheet has something
 * concrete to show for "the four clips it did not pick" — the card's own
 * example of what turns "trust me" into a decision someone can disagree
 * with.
 */
import type { FootageClip, FootagePlan, Plan } from "@shortreelcuts/plan";
import { makeRng } from "./rng.js";
import type { DecisionCandidate, PlanSoFarInput, StageResult } from "./types.js";

const ANGLES = ["wide shot", "close-up", "over-the-shoulder", "slow pan"] as const;

function candidatesFor(beatId: string, search: string): DecisionCandidate[] {
  return ANGLES.map((angle, i) => ({
    id: `${beatId}-candidate-${i}`,
    label: `${search} — ${angle}`,
    chosen: false,
  }));
}

export async function runFootage(input: PlanSoFarInput): Promise<StageResult<Pick<Plan, "footage">>> {
  const rng = makeRng(input.plan.seed + 2);
  const footage: Record<string, FootageClip> = {};
  const candidates: Record<string, readonly DecisionCandidate[]> = {};

  for (const beat of input.plan.script.beats) {
    const options = candidatesFor(beat.id, beat.search);
    const chosenIndex = Math.floor(rng() * options.length) % options.length;
    const chosenOption = options[chosenIndex] as DecisionCandidate;
    const marked = options.map((o) => ({ ...o, chosen: o.id === chosenOption.id }));

    footage[beat.id] = {
      provider: "stub",
      assetId: chosenOption.id,
      in: 0,
      out: 4.0,
      reason: `closest of ${options.length} candidates for "${beat.search}"`,
    };
    candidates[`footage.${beat.id}`] = marked;
  }

  return {
    patch: { footage: footage as FootagePlan },
    candidates,
  };
}
