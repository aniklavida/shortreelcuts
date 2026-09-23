/**
 * The stage runner contract the decision sheet is built against.
 *
 * The sheet is built against stubbed stages on purpose. Only `compose`
 * has a real implementation anywhere in this repository
 * (`@shortreelcuts/render`) — `script`, `voice`, `footage` and `align`
 * do not exist as products yet. This file is the seam that keeps that
 * honest: every stub implements the same shape a
 * real provider-backed stage would, so wiring in a real script/voice/
 * footage/align stage later means swapping the object passed to
 * `ProjectSession`, not touching the sheet.
 *
 * This mirrors SPEC.md §7's adapter rule in spirit — "a provider returns
 * candidates, never a final choice" — one level up: here a *stage*
 * returns candidates plus the one it picked, because the sheet needs
 * exactly that shape to show the candidates a stage rejected alongside
 * the one it chose (`docs/SPEC.md` §8).
 */
import type { AlignPlan, Brief, FootagePlan, Plan, ScopedBeats, ScriptPlan, Stage, VoicePlan } from "@shortreelcuts/plan";
import type { ResolvedMedia, VideoFile } from "@shortreelcuts/render";

/** One alternative a stage considered. Never the plan's own shape — display data only. */
export interface DecisionCandidate {
  readonly id: string;
  readonly label: string;
  readonly chosen: boolean;
}

/**
 * What a stage run produced: the plan patch (the actual decision, which is
 * what gets persisted) plus, keyed by decision-row id, the candidates it
 * weighed to get there. `candidates` is sheet-only metadata — it is never
 * part of the `Plan` document, because the plan is the decision, not the
 * deliberation behind it.
 */
export interface StageResult<TPatch> {
  readonly patch: TPatch;
  readonly candidates: Readonly<Record<string, readonly DecisionCandidate[]>>;
}

export interface ScriptRunInput {
  readonly brief: Brief;
  readonly seed: number;
}

/** Every later stage reads the plan produced so far — never a side channel. See STRUCTURE.md's plan-is-the-only-shared-state rule. */
export interface PlanSoFarInput {
  readonly plan: Plan;
}

export interface FramesRunInput extends PlanSoFarInput {
  /** Directory for intermediate clips and cache. */
  readonly workDir: string;
  /** Restricts rendering to specific beats, or "all" (default). */
  readonly scopedBeats?: ScopedBeats;
  /** In-memory or pre-resolved clip mapping to reuse. */
  readonly clipCache?: Readonly<Record<string, string>>;
}

export interface FramesRunResult extends StageResult<{ render?: Plan["render"] }> {
  /** Map of beatId -> normalized intermediate clip file path (1080x1920 30fps). */
  readonly clips: Readonly<Record<string, string>>;
  /** Which beats actually had their frames rendered (vs reused from cache). */
  readonly renderedBeats: readonly string[];
}

export interface ComposeRunInput extends PlanSoFarInput {
  /** Scratch directory for synthesized stand-in media and the rendered file. Not persisted by this package. */
  readonly workDir: string;
  /** Pre-resolved media (e.g. normalized footage clips from the frames stage). */
  readonly media?: Partial<ResolvedMedia>;
}

export interface ComposeRunResult extends StageResult<Pick<Plan, "captions" | "music" | "format">> {
  readonly video: VideoFile;
}

/**
 * One runner per pipeline stage (`@shortreelcuts/plan`'s `STAGES`). A
 * runner is idempotent given the same plan-so-far: it may be called once
 * during the first generate, or again later because `invalidate()` says
 * this stage is downstream of something that changed. It never mutates
 * its input.
 */
export interface StageRunners {
  script(input: ScriptRunInput): Promise<StageResult<Pick<Plan, "script">>>;
  voice(input: PlanSoFarInput): Promise<StageResult<Pick<Plan, "voice">>>;
  footage(input: PlanSoFarInput): Promise<StageResult<Pick<Plan, "footage">>>;
  align(input: PlanSoFarInput): Promise<StageResult<Pick<Plan, "align">>>;
  frames(input: FramesRunInput): Promise<FramesRunResult>;
  compose(input: ComposeRunInput): Promise<ComposeRunResult>;
}

export type { AlignPlan, FootagePlan, Plan, ScopedBeats, ScriptPlan, Stage, VoicePlan };
