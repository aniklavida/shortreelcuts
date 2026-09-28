/**
 * The footage stage.
 *
 * Chooses footage per scene across the three footage sources: stock clips,
 * AI-generated video, and motion graphics written as code. Each source is
 * resolved through the one shared `FootageAdapter` interface.
 *
 * Two runners live here, mirroring the script and voice stages
 * (`script.ts`, `voice.ts`), and `apps/worker`'s default runners pick
 * between them once, at boot (`runners.ts`), from the environment alone:
 *
 * - `createFootageRunner(provider)` drives a real `FootageProvider` — the
 *   provider-neutral seam `docs/SPEC.md` §7 describes, so Pexels and
 *   Pixabay are the same call and the stage cannot tell them apart. The
 *   provider returns candidates; the stage picks one deterministically
 *   from them, records provenance and the search term in the plan reason,
 *   and every returned clip becomes a candidate on the sheet's override
 *   control. Before returning, each candidate *and* the chosen clip passes
 *   `assertCandidateCarriesNoMediaUrl` / `assertClipCarriesNoMediaUrl`: a
 *   plan records the library's asset id and nothing that re-points at the
 *   media, because a plan is exportable and shareable and a baked-in
 *   download URL would be a licence-redistribution leak with legs. The
 *   whole candidate set is checked rather than only the winner, because the
 *   set is stored next to the plan and a leak in an unchosen candidate is
 *   just as much a leak.
 * - `runFootage` is the deterministic stub, and the explicit fallback when
 *   no footage connection is configured. It proposes candidates from its
 *   own catalogue, picks one, and its plan reason plainly says it is a
 *   stub — never a silent downgrade that could be mistaken for a library
 *   search, and never a synthetic asset id presented as a real clip.
 *
 * A failure from the real provider is re-thrown as a `FootageSearchError`:
 * a stage that cannot get a real candidate list fails loudly instead of
 * quietly falling back to the stub (`docs/SPEC.md` §7 rule 1 — a plan
 * field either came from a real decision or the stage fails, never a
 * third option).
 *
 * Determinism: the library's result set is not reproducible, so it is not
 * re-derived. The stage records the *chosen* asset id in the plan, and the
 * render re-resolves that id to a media URL — re-rendering a plan fetches
 * the same clip. Running the footage stage again is a different thing, and
 * may legitimately propose different candidates.
 */
import { createHash } from "node:crypto";
import type { FootageClip, FootagePlan, Plan, StockFootage } from "@shortreelcuts/plan";
import type {
  BeatContext,
  Candidate,
  FootageAdapter,
  FootageProvider,
  FootageSource,
  MediaSink,
} from "@shortreelcuts/providers";
import { StockFootageAdapter, assertCandidateCarriesNoMediaUrl, assertClipCarriesNoMediaUrl } from "@shortreelcuts/providers";
import { makeRng, pick } from "./rng.js";
import type { DecisionCandidate, PlanSoFarInput, StageResult, StageRunners } from "./types.js";

/** How many clips a stock library is asked for per scene. Four is the sheet's "here are the three I did not pick". */
export const FOOTAGE_CANDIDATE_COUNT = 4;

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

/** Portrait output is taller than it is wide — the 1080×1920 default is a portrait video. */
function orientationFor(format: { width: number; height: number }): "portrait" | "landscape" | "square" {
  if (format.width < format.height) return "portrait";
  if (format.width > format.height) return "landscape";
  return "square";
}

/**
 * The deterministic stub, and the explicit fallback when no footage
 * connection is configured. Its reason always names itself as a stub and
 * says the asset id is synthetic, so a plan produced without a stock
 * library cannot be read as one that had a library search behind it — the
 * honesty requirement is in the plan, not only in a comment.
 */
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
      const chosen = pick(rng, options);
      const marked = options.map((o) => ({ ...o, chosen: o.id === chosen.id }));

      footage[beat.id] = {
        source: "stock",
        provider: "stub",
        assetId: chosen.id,
        in: 0,
        out: 4.0,
        credit: { creator: "a stub creator", pageUrl: `https://stub.invalid/${chosen.id}` },
        reason:
          `Deterministic footage stub — no stock library was searched. "${chosen.label}" is the closest of ` +
          `${options.length} fixed angles for "${beat.search}"; the asset id is synthetic and will not resolve to a real clip.`,
      };
      candidates[`footage.${beat.id}`] = marked;
    }
  }

  return {
    patch: { footage: footage as FootagePlan },
    candidates,
  };
}

/** Thrown when a real provider's candidates cannot become a plan. Never swallowed into the stub. */
export class FootageSearchError extends Error {
  constructor(providerId: string, beatId: string | undefined, cause: unknown) {
    super(
      beatId
        ? `the connected footage provider (${providerId}) returned nothing usable for scene ${beatId}; ` +
          "the stage failed rather than falling back to the deterministic stub"
        : `the connected footage provider (${providerId}) failed to return candidate clips; ` +
          "the stage failed rather than falling back to the deterministic stub",
    );
    this.name = "FootageSearchError";
    this.cause = cause;
  }
}

/** A clip long enough for the scene, without asking for more of it than the library holds. */
function outPointFor(durationSeconds: number, targetSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return targetSeconds;
  return Math.min(durationSeconds, targetSeconds);
}

/**
 * The real-provider runner. Asks the connected library for candidates per
 * scene, selects one deterministically from the plan's own seed, records
 * why — provider, asset, duration, how many it weighed and the search term
 * it searched — and refuses to record a clip that carries a media URL.
 */
export function createFootageRunner(provider: FootageProvider): StageRunners["footage"] {
  return async (input) => {
    const rng = makeRng(input.plan.seed + 2);
    const format = input.plan.format ?? { width: 1080, height: 1920, fps: 30 };
    const orientation = orientationFor(format);
    const targetSeconds = 4;
    const footage: Record<string, FootageClip> = {};
    const candidates: Record<string, readonly DecisionCandidate[]> = {};

    for (const beat of input.plan.script.beats) {
      let options;
      try {
        options = await provider.search({
          beatId: beat.id,
          search: beat.search,
          count: FOOTAGE_CANDIDATE_COUNT,
          targetSeconds,
          orientation,
        });
      } catch (err) {
        throw new FootageSearchError(provider.id, beat.id, err);
      }

      if (options.length === 0) {
        throw new FootageSearchError(
          provider.id,
          beat.id,
          new Error(`the library returned no clips for the search term "${beat.search}"`),
        );
      }

      // Every candidate, not only the one this seed happens to pick. The
      // whole set is recorded next to the plan and shown on the sheet, so a
      // leak in an unchosen candidate is just as much a leak.
      for (const option of options) {
        assertCandidateCarriesNoMediaUrl(option, provider.id, provider.planUrlHosts);
      }

      const chosen = pick(rng, options);
      const clip: StockFootage = {
        source: "stock",
        provider: provider.id,
        assetId: chosen.assetId,
        in: 0,
        out: outPointFor(chosen.durationSeconds, targetSeconds),
        credit: chosen.credit,
        reason:
          `Selected stock clip "${chosen.label}" (asset ${chosen.assetId}` +
          `${chosen.durationSeconds > 0 ? `, ${chosen.durationSeconds}s` : ""}) as the closest of ` +
          `${options.length} clips the connected footage provider (${provider.id}) returned for ` +
          `"${beat.search}", trimmed to ${outPointFor(chosen.durationSeconds, targetSeconds)}s and cropped to ${format.width}×${format.height}.`,
      };

      // The load-bearing assertion. A plan is exportable and shareable, so
      // nothing that re-points at the media may be recorded in one — only
      // the library's asset id, which re-resolves at render time.
      assertClipCarriesNoMediaUrl(clip, provider.planUrlHosts);

      footage[beat.id] = clip;
      candidates[`footage.${beat.id}`] = options.map((option) => ({
        id: option.assetId,
        label: option.label,
        chosen: option.assetId === chosen.assetId,
      }));
    }

    return {
      patch: { footage: footage as FootagePlan },
      candidates,
    };
  };
}
