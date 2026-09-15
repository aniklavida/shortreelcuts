/**
 * The footage stage — stubbed.
 *
 * `docs/SPEC.md` §11 settles the footage sources — stock clips, AI-generated
 * video, and motion graphics written as code, chosen per scene and mixable
 * in one video — but none of the three is implemented yet. This stub
 * proposes several candidate clips per beat and picks one, so the sheet
 * has something concrete to show for the candidates it did not pick
 * (`docs/SPEC.md` §8), which is what turns "trust me" into a decision
 * someone can disagree with.
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

    // `docs/SPEC.md` §11 names three footage sources; only stock has ever had a
    // stand-in here, and this stub does not yet pick between them (that choice
    // is proposal work item 6, the model-driven per-beat source pick). "stock"
    // is the honest default until it does.
    footage[beat.id] = {
      source: "stock",
      provider: "stub",
      assetId: chosenOption.id,
      in: 0,
      out: 4.0,
      credit: { creator: "a stub creator", pageUrl: `https://stub.invalid/${chosenOption.id}` },
      reason: `closest of ${options.length} candidates for "${beat.search}"`,
    };
    candidates[`footage.${beat.id}`] = marked;
  }

  return {
    patch: { footage: footage as FootagePlan },
    candidates,
  };
}
