/**
 * The voice stage.
 *
 * Two runners live here, mirroring the script stage (`script.ts`), and
 * `apps/worker`'s default runners pick between them once, at boot
 * (`runners.ts`), from the environment alone:
 *
 * - `createVoiceRunner(provider)` drives a real `VoiceProvider` — the
 *   provider-neutral seam `docs/SPEC.md` §7 describes, so a hosted
 *   bring-your-own-key model and a model running on the self-hoster's own
 *   hardware are the same call. The provider declares its available voices
 *   through `voices()`; the runner selects a voice deterministically from
 *   those candidates and records provenance in the plan reason. Every
 *   declared voice appears as a candidate on the sheet's override control.
 * - `runVoice` is the deterministic stub, and the explicit fallback when
 *   no voice connection is configured. It proposes candidates from its
 *   catalogue, picks one and records why, and its plan reason plainly says
 *   it is a stub — never a silent downgrade that could be mistaken for a
 *   real generation.
 *
 * A failure from the real provider is re-thrown as a `VoiceGenerationError`:
 * a stage that cannot get a real voice selection fails loudly instead of
 * quietly falling back to the stub (`docs/SPEC.md` §7 rule 1 — a plan field
 * either came from a real decision or the stage fails, never a third option).
 */
import type { Plan, VoicePlan } from "@shortreelcuts/plan";
import type { VoiceDescriptor as ProviderVoiceDescriptor, VoiceProvider } from "@shortreelcuts/providers";
import { makeRng, pick } from "./rng.js";
import type { DecisionCandidate, PlanSoFarInput, StageResult, StageRunners } from "./types.js";

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

/**
 * The deterministic stub. Its reason always names itself as a stub, so a
 * plan produced without a voice connection cannot be read as one that had
 * one — the honesty requirement is in the plan, not only in a comment.
 */
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
    reason: `Deterministic voice stub — no speech engine was called. "${chosen.label}" matches the brief's "${input.plan.brief.tone}" tone at a normal speaking pace`,
  };

  return {
    patch: { voice },
    candidates: { "voice.voiceId": candidates },
  };
}

/** Thrown when a real provider's output cannot become a plan. Never swallowed into the stub. */
export class VoiceGenerationError extends Error {
  constructor(providerId: string, cause: unknown) {
    super(
      `the connected voice provider (${providerId}) failed to declare available voices; ` +
        "the stage failed rather than falling back to the deterministic stub",
    );
    this.name = "VoiceGenerationError";
    this.cause = cause;
  }
}

/**
 * The real-provider runner. Queries the provider's capability declaration
 * (`voices()`), chooses a candidate deterministically, and records provenance
 * and rejected alternatives in the candidate strip.
 */
export function createVoiceRunner(provider: VoiceProvider): StageRunners["voice"] {
  return async (input) => {
    let descriptors: ProviderVoiceDescriptor[];
    try {
      descriptors = await provider.voices();
    } catch (err) {
      throw new VoiceGenerationError(provider.id, err);
    }

    if (descriptors.length === 0) {
      throw new VoiceGenerationError(
        provider.id,
        new Error("the connected voice provider declared no available voices"),
      );
    }

    const rng = makeRng(input.plan.seed + 1);
    const chosen = pick(rng, descriptors);

    const candidates: DecisionCandidate[] = descriptors.map((v) => ({
      id: v.id,
      label: v.label,
      chosen: v.id === chosen.id,
    }));

    const reason = `Selected "${chosen.label}" from connected voice provider (${provider.id}) at a normal speaking pace.`;

    const voice: VoicePlan = {
      provider: provider.id,
      voiceId: chosen.id,
      rate: 1.0,
      reason,
    };

    return {
      patch: { voice },
      candidates: { "voice.voiceId": candidates },
    };
  };
}
