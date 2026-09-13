/**
 * The voice stage — stubbed.
 *
 * No TTS provider exists (SPEC.md §5.1 is open, and DECISIONS.md rejects
 * `edge-tts` regardless). `STUB_VOICES` stands in for what a real
 * `VoiceProvider.voices()` capability call would return (SPEC.md §7) —
 * it is what the sheet's voice `OverrideControl` is resolved from, so
 * swapping this for a real provider later changes zero UI code.
 */
import type { Plan, VoicePlan } from "@shortreelcuts/plan";
import { makeRng, pick } from "./rng.js";
import type { DecisionCandidate, PlanSoFarInput, StageResult } from "./types.js";

export interface VoiceDescriptor {
  readonly id: string;
  readonly label: string;
  readonly bestForTone: readonly string[];
}

/** The stub's whole "provider": a fixed, honestly-small catalogue rather than a hidden infinite one. */
export const STUB_VOICES: readonly VoiceDescriptor[] = [
  { id: "warm-female", label: "Warm, unhurried female voice", bestForTone: ["calm", "warm", "gentle"] },
  { id: "confident-male", label: "Confident, energetic male voice", bestForTone: ["energetic", "bold", "urgent"] },
  { id: "neutral-female", label: "Clear, neutral female voice", bestForTone: ["neutral", "informative"] },
  { id: "neutral-male", label: "Clear, neutral male voice", bestForTone: ["neutral", "informative"] },
];

function bestMatch(rng: () => number, tone: string): VoiceDescriptor {
  const matches = STUB_VOICES.filter((v) => v.bestForTone.includes(tone.toLowerCase()));
  return matches.length > 0 ? (matches[0] as VoiceDescriptor) : pick(rng, STUB_VOICES);
}

export async function runVoice(input: PlanSoFarInput): Promise<StageResult<Pick<Plan, "voice">>> {
  const rng = makeRng(input.plan.seed + 1); // offset from script's seed so the two stages don't correlate
  const chosen = bestMatch(rng, input.plan.brief.tone);

  const candidates: DecisionCandidate[] = STUB_VOICES.map((v) => ({
    id: v.id,
    label: v.label,
    chosen: v.id === chosen.id,
  }));

  const voice: VoicePlan = {
    provider: "stub",
    voiceId: chosen.id,
    rate: 1.0,
    reason: `"${chosen.label}" matches the brief's "${input.plan.brief.tone}" tone at a normal speaking pace`,
  };

  return {
    patch: { voice },
    candidates: { "voice.voiceId": candidates },
  };
}
