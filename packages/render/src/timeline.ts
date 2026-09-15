/**
 * Plan → an ordered timeline of scenes and caption cues. Pure: no ffmpeg,
 * no filesystem. `filtergraph.ts` turns this into ffmpeg arguments;
 * `run.ts` is the only place that measures real files and spawns anything.
 *
 * The decision this file encodes, because the plan schema does not (yet)
 * carry it: **a scene's on-screen duration is its narration's measured
 * duration**, not the footage stage's `in`/`out` span. `in`/`out` is which
 * part of the source clip to show; how long it is shown for is set by how
 * long the beat takes to say, because captions and narration are timed
 * against the spoken word (`align.words`) and a scene that ran on its own
 * clock would drift out from under both. Footage shorter than that is held
 * on its last frame (`tpad` in the filtergraph); footage longer is trimmed.
 *
 * The other thing decided here: consecutive scenes crossfade rather than
 * cut. `packages/plan`'s schema has no per-beat transition field yet, so
 * the crossfade duration is a renderer default (`DEFAULT_TRANSITION_SECONDS`),
 * not a plan decision — every beat gets the same one. A `transitions` plan
 * field is future scope, not invented here as a parallel config format.
 */
import type { AlignedWord, Plan } from "@shortreelcuts/plan";

export const DEFAULT_TRANSITION_SECONDS = 0.4;

/** A group of words to show as one on-screen caption, at their place on the final timeline. */
export interface Cue {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly text: string;
}

/**
 * Groups one beat's word-level timings into `wordsPerCue`-sized captions,
 * shifted by `offsetSeconds` — the beat's start on the final timeline —
 * so the cues this returns are already in global time. `align.words[beat]`
 * timings are relative to that beat's own narration clip; nothing else in
 * this file converts between the two, so getting this shift right here is
 * what keeps a caption from drifting off the word it belongs to.
 */
export function buildCuesForBeat(words: readonly AlignedWord[], wordsPerCue: number, offsetSeconds: number): Cue[] {
  const cues: Cue[] = [];
  for (let i = 0; i < words.length; i += wordsPerCue) {
    const group = words.slice(i, i + wordsPerCue);
    const first = group[0];
    const last = group[group.length - 1];
    if (!first || !last) {
      continue;
    }
    cues.push({
      startSeconds: offsetSeconds + first.startSeconds,
      endSeconds: offsetSeconds + last.endSeconds,
      text: group.map((word) => word.word).join(" "),
    });
  }
  return cues;
}

export interface SceneClip {
  readonly beatId: string;
  readonly footagePath: string;
  /** The footage stage's chosen crop of the source file. */
  readonly sourceInSeconds: number;
  readonly sourceOutSeconds: number;
  readonly narrationPath: string;
  /** Measured by ffprobe, not computed from `align.words` — see module doc. */
  readonly narrationDurationSeconds: number;
  /** How long this scene is on screen. Equal to `narrationDurationSeconds`. */
  readonly sceneDurationSeconds: number;
  /**
   * How much of the trimmed footage (`sourceOutSeconds - sourceInSeconds`,
   * clamped to what the source file actually contains) to hold on its last
   * frame to reach `sceneDurationSeconds`. Zero when the footage is already
   * long enough.
   */
  readonly holdLastFrameSeconds: number;
  /** Where this scene starts on the final, post-crossfade timeline. */
  readonly startOffsetSeconds: number;
}

export interface Timeline {
  readonly scenes: readonly SceneClip[];
  readonly cues: readonly Cue[];
  readonly transitionSeconds: number;
  readonly totalDurationSeconds: number;
}

export interface MeasuredDurations {
  /** Actual narration audio duration per beat id, from ffprobe. */
  readonly narrationSeconds: Readonly<Record<string, number>>;
  /** Actual footage source duration per beat id, from ffprobe. */
  readonly footageSeconds: Readonly<Record<string, number>>;
}

export interface TimelineMedia {
  readonly footage: Readonly<Record<string, string>>;
  readonly narration: Readonly<Record<string, string>>;
}

function requireEntry(record: Readonly<Record<string, number>>, beatId: string, what: string): number {
  const value = record[beatId];
  if (value === undefined) {
    throw new Error(`missing measured ${what} duration for beat "${beatId}"`);
  }
  return value;
}

function requirePath(record: Readonly<Record<string, string>>, beatId: string, what: string): string {
  const value = record[beatId];
  if (value === undefined) {
    throw new Error(`missing resolved ${what} path for beat "${beatId}"`);
  }
  return value;
}

function wordsForBeat(plan: Plan, beatId: string): readonly AlignedWord[] {
  return plan.align.words[beatId] ?? [];
}

export function buildTimeline(
  plan: Plan,
  media: TimelineMedia,
  measured: MeasuredDurations,
  transitionSeconds: number = DEFAULT_TRANSITION_SECONDS,
): Timeline {
  const beats = plan.script.beats;
  if (beats.length === 0) {
    throw new Error("plan.script.beats is empty — nothing to render");
  }

  const transition = beats.length > 1 ? transitionSeconds : 0;
  const scenes: SceneClip[] = [];
  const cues: Cue[] = [];
  let previousSceneEndSeconds = 0;

  for (const [index, beat] of beats.entries()) {
    const footageClip = plan.footage[beat.id];
    if (!footageClip) {
      throw new Error(`no footage decision for beat "${beat.id}"`);
    }
    // `planVersion` 2 makes footage a three-source union (`docs/SPEC.md` §11), but
    // `frames` — the stage that would normalise a generated clip or a rendered
    // motion scene into the same shape a stock clip already has — has no runner
    // built yet (§6). Compose only ever received a stock-shaped `in`/`out` crop,
    // so it still only knows how to build a timeline from one; every migrated
    // `planVersion` 1 plan is stock-only, so this is not a narrowing of what
    // already works today.
    if (footageClip.source !== "stock") {
      throw new Error(
        `beat "${beat.id}" uses a "${footageClip.source}" footage source, which compose cannot place on a ` +
          `timeline directly yet — the frames stage that would normalise it into a clip has no runner built yet`,
      );
    }

    const narrationDurationSeconds = requireEntry(measured.narrationSeconds, beat.id, "narration");
    const footageSourceDurationSeconds = requireEntry(measured.footageSeconds, beat.id, "footage");
    const footagePath = requirePath(media.footage, beat.id, "footage");
    const narrationPath = requirePath(media.narration, beat.id, "narration");

    if (narrationDurationSeconds <= transition * 2) {
      throw new Error(
        `beat "${beat.id}" narration (${narrationDurationSeconds.toFixed(2)}s) is too short for a ` +
          `${transitionSeconds.toFixed(2)}s crossfade on each side — shorten the transition or lengthen the beat`,
      );
    }

    const sourceInSeconds = footageClip.in;
    const sourceOutSeconds = Math.min(footageClip.out, footageSourceDurationSeconds);
    if (sourceOutSeconds <= sourceInSeconds) {
      throw new Error(
        `beat "${beat.id}" footage source is only ${footageSourceDurationSeconds.toFixed(2)}s long, ` +
          `too short to honour in=${sourceInSeconds}`,
      );
    }
    const availableFootageSeconds = sourceOutSeconds - sourceInSeconds;

    const sceneDurationSeconds = narrationDurationSeconds;
    const holdLastFrameSeconds = Math.max(0, sceneDurationSeconds - availableFootageSeconds);

    const startOffsetSeconds = index === 0 ? 0 : previousSceneEndSeconds - transition;

    scenes.push({
      beatId: beat.id,
      footagePath,
      sourceInSeconds,
      sourceOutSeconds,
      narrationPath,
      narrationDurationSeconds,
      sceneDurationSeconds,
      holdLastFrameSeconds,
      startOffsetSeconds,
    });

    cues.push(...buildCuesForBeat(wordsForBeat(plan, beat.id), plan.captions.wordsPerCue, startOffsetSeconds));

    previousSceneEndSeconds = startOffsetSeconds + sceneDurationSeconds;
  }

  return {
    scenes,
    cues,
    transitionSeconds: transition,
    totalDurationSeconds: previousSceneEndSeconds,
  };
}
