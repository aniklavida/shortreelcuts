/**
 * The compose stage's input and output contract.
 *
 * SPEC.md §7 sketches the eventual adapter interface as
 * `render(plan: Plan, media: ResolvedMedia): Promise<VideoFile>`. The
 * `Renderer` adapter itself, and the `MediaStore` that would produce a
 * `ResolvedMedia` from a plan's `footage`/`voice`/`music` decisions, are
 * not built yet — this package is the implementation behind that seam
 * (STRUCTURE.md's `packages/render`, separate from `packages/providers/render`).
 *
 * `ResolvedMedia` is not a parallel plan format. It carries no decisions —
 * every decision (which clip, which voice, which track, the caption style)
 * still lives in the `Plan`. It only carries where the bytes that plan
 * refers to currently sit on disk, keyed the same way the plan is keyed.
 */
import type { Plan } from "@shortreelcuts/plan";

export interface ResolvedMedia {
  /** Absolute path to the chosen footage clip's source file, keyed by beat id. */
  readonly footage: Readonly<Record<string, string>>;
  /** Absolute path to that beat's narration audio file, keyed by beat id. */
  readonly narration: Readonly<Record<string, string>>;
  /** Absolute path to the background music bed. Required when `plan.music.enabled`. */
  readonly music?: string;
}

export interface VideoFile {
  /** Absolute path to the rendered MP4. */
  readonly path: string;
  /** Absolute path to the sidecar `.srt`. SPEC.md §15 — burned in captions ship one anyway. */
  readonly captionsPath: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  /** Measured by ffprobe on the finished file, not computed — this is what actually shipped. */
  readonly durationSeconds: number;
}

export interface RenderOptions {
  /** Absolute path to write the MP4 to. */
  readonly outputPath: string;
  /** Where the sidecar `.srt` is written. Defaults next to `outputPath`. */
  readonly srtPath?: string;
  /** Directory for intermediate files (the generated `.ass`). Defaults to `outputPath`'s directory. */
  readonly workDir?: string;
  /** Overrides `SHORTREELCUTS_FFMPEG_PATH` / the `ffmpeg` on `PATH`. */
  readonly ffmpegPath?: string;
  /** Overrides `SHORTREELCUTS_FFPROBE_PATH` / the `ffprobe` on `PATH`. */
  readonly ffprobePath?: string;
  /**
   * Crossfade duration between consecutive scenes, in seconds. Not part of
   * the plan schema yet, so it is a render-time argument rather than a
   * recorded decision: it gets no row on the decision sheet, and two renders
   * of one plan are only byte-identical if both pass the same value (or
   * both omit it and take the default).
   */
  readonly transitionSeconds?: number;
  /** Target average video bitrate, e.g. `"6M"`. A sane default is chosen for `plan.format`. */
  readonly videoBitrate?: string;
}

/** A plan whose every beat has a chosen clip and word-level timings — what compose actually needs. */
export function requireBeatCoverage(plan: Plan, media: ResolvedMedia): void {
  for (const beat of plan.script.beats) {
    if (!plan.footage[beat.id]) {
      throw new Error(`plan is missing a footage decision for beat "${beat.id}"`);
    }
    if (!plan.align.words[beat.id]) {
      throw new Error(`plan is missing word alignment for beat "${beat.id}"`);
    }
    if (!media.footage[beat.id]) {
      throw new Error(`no resolved footage file for beat "${beat.id}"`);
    }
    if (!media.narration[beat.id]) {
      throw new Error(`no resolved narration file for beat "${beat.id}"`);
    }
  }
  if (plan.music.enabled && !media.music) {
    throw new Error("plan.music.enabled is true but no music file was resolved");
  }
}
