/**
 * The footage stage.
 *
 * Chooses footage per scene across the three footage sources: stock clips,
 * AI-generated video, and motion graphics written as code.
 *
 * Each footage source is resolved through the one shared FootageAdapter
 * interface, declaring capabilities, proposing candidates, and materialising
 * the chosen clip with a recorded reason.
 */
import { createHash } from "node:crypto";
import type { FootageClip, FootagePlan, Plan } from "@shortreelcuts/plan";
import type {
  BeatContext,
  Candidate,
  FootageAdapter,
  FootageSource,
  MediaSink,
} from "@shortreelcuts/providers";
import { StockFootageAdapter } from "@shortreelcuts/providers";
import { makeRng } from "./rng.js";
import type { DecisionCandidate, PlanSoFarInput, StageResult } from "./types.js";

const ANGLES = ["wide shot", "close-up", "over-the-shoulder", "slow pan"] as const;

function fallbackCandidatesFor(beatId: string, search: string): DecisionCandidate[] {
  return ANGLES.map((angle, i) => ({
    id: `${beatId}-candidate-${i}`,
    label: `${search} — ${angle}`,
    chosen: false,
  }));
}

export interface FootageRunInput extends PlanSoFarInput {
  readonly adapters?: Partial<Record<FootageSource, FootageAdapter>>;
  readonly sourceByBeat?: Readonly<Record<string, FootageSource>>;
  readonly mediaSink?: MediaSink;
}

function makeFallbackMediaSink(): MediaSink {
  const store = new Map<string, Uint8Array>();
  return {
    async put(bytes: Uint8Array): Promise<string> {
      const digest = createHash("sha256").update(bytes).digest("hex");
      const key = `sha256:${digest}`;
      store.set(key, bytes);
      return key;
    },
  };
}

export async function runFootage(
  input: FootageRunInput,
): Promise<StageResult<Pick<Plan, "footage">>> {
  const rng = makeRng(input.plan.seed + 2);
  const footage: Record<string, FootageClip> = {};
  const candidates: Record<string, readonly DecisionCandidate[]> = {};
  const media = input.mediaSink ?? makeFallbackMediaSink();

  for (let index = 0; index < input.plan.script.beats.length; index++) {
    const beat = input.plan.script.beats[index]!;
    const requestedSource = input.sourceByBeat?.[beat.id];
    const adapter = requestedSource && input.adapters?.[requestedSource]
      ? input.adapters[requestedSource]
      : input.adapters?.["stock"];

    if (adapter) {
      const beatContext: BeatContext = {
        beatId: beat.id,
        narration: beat.narration,
        onScreen: beat.onScreen,
        search: beat.search,
        format: input.plan.format ?? { width: 1080, height: 1920, fps: 30 },
        targetSeconds: 4,
      };

      const options = await adapter.propose(beatContext, 4);
      const chosenIndex = Math.floor(rng() * options.length) % options.length;
      const chosenCandidate = options[chosenIndex] as Candidate;
      const marked = options.map((o) => ({
        id: o.id,
        label: o.label,
        chosen: o.id === chosenCandidate.id,
      }));

      const clip = await adapter.materialise(chosenCandidate, { media });
      footage[beat.id] = clip;
      candidates[`footage.${beat.id}`] = marked;
    } else {
      const options = fallbackCandidatesFor(beat.id, beat.search);
      const chosenIndex = Math.floor(rng() * options.length) % options.length;
      const chosenOption = options[chosenIndex] as DecisionCandidate;
      const marked = options.map((o) => ({ ...o, chosen: o.id === chosenOption.id }));

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
  }

  return {
    patch: { footage: footage as FootagePlan },
    candidates,
  };
}
