/**
 * The align stage — stubbed.
 *
 * Alignment is meant to be a Whisper-family runtime run as a separate
 * process (`docs/SPEC.md` §14) — not built yet. Unlike the other stubs,
 * alignment never chooses between candidates (the spec doesn't model it as
 * one); it measures. So this stub has no rejected options to show — its
 * decision row on the sheet is read-only, which `decisions.ts` renders as
 * such.
 */
import type { AlignedWord, AlignPlan, Plan } from "@shortreelcuts/plan";
import type { PlanSoFarInput, StageResult } from "./types.js";

/** A flat per-word duration stand-in. A real aligner measures this from audio; this approximates from rate alone. */
const SECONDS_PER_WORD = 0.32;

function timeWords(narration: string, rate: number): AlignedWord[] {
  const words = narration.split(/\s+/).filter((w) => w.length > 0);
  const perWord = SECONDS_PER_WORD / rate;
  let cursor = 0;
  return words.map((word) => {
    const startSeconds = cursor;
    const endSeconds = cursor + perWord;
    cursor = endSeconds;
    return { word, startSeconds, endSeconds };
  });
}

export async function runAlign(input: PlanSoFarInput): Promise<StageResult<Pick<Plan, "align">>> {
  const words: Record<string, AlignedWord[]> = {};
  for (const beat of input.plan.script.beats) {
    words[beat.id] = timeWords(beat.narration, input.plan.voice.rate);
  }

  const totalWords = Object.values(words).reduce((sum, w) => sum + w.length, 0);

  const align: AlignPlan = {
    provider: "stub-aligner",
    words,
    reason: `${totalWords} words timed at ~${SECONDS_PER_WORD.toFixed(2)}s each, scaled by the chosen voice's rate — not a measurement of real audio yet`,
  };

  return { patch: { align }, candidates: {} };
}
