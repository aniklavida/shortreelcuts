/**
 * Timeline → an ffmpeg filter graph. Pure string-building: given a
 * `Timeline` (already measured and offset by `timeline.ts`) and the plan's
 * output format, this decides the exact `-filter_complex` ffmpeg will run.
 * Nothing here touches the filesystem or spawns a process — `run.ts` does
 * that with what this file returns.
 */
import type { FormatPlan } from "@shortreelcuts/plan";
import type { SceneClip, Timeline } from "./timeline.js";

const EPSILON_SECONDS = 0.005;

export interface FilterGraphSegment {
  /** `-i` arguments to append, in order, starting at `startInputIndex`. */
  readonly inputPaths: readonly string[];
  readonly startInputIndex: number;
  readonly filterLines: readonly string[];
  /** The label (without brackets) this segment's output is available under. */
  readonly outputLabel: string;
}

function sceneVideoFilterLines(scene: SceneClip, index: number, inputIndex: number, format: FormatPlan): string[] {
  const trimmedLabel = `pre${index}`;
  const sceneLabel = `scene${index}`;
  const availableSeconds = scene.sourceOutSeconds - scene.sourceInSeconds;

  const trim = [
    `[${inputIndex}:v]trim=start=${scene.sourceInSeconds}:end=${scene.sourceOutSeconds}`,
    "setpts=PTS-STARTPTS",
    `scale=w=${format.width}:h=${format.height}:force_original_aspect_ratio=increase`,
    `crop=${format.width}:${format.height}`,
    `fps=${format.fps}`,
    "format=yuv420p",
    "setsar=1",
  ].join(",");

  if (scene.holdLastFrameSeconds > EPSILON_SECONDS) {
    return [
      `${trim}[${trimmedLabel}]`,
      `[${trimmedLabel}]tpad=stop_mode=clone:stop_duration=${scene.holdLastFrameSeconds.toFixed(3)}[${sceneLabel}]`,
    ];
  }

  const excessSeconds = availableSeconds - scene.sceneDurationSeconds;
  if (excessSeconds > EPSILON_SECONDS) {
    return [
      `${trim}[${trimmedLabel}]`,
      `[${trimmedLabel}]trim=end=${scene.sceneDurationSeconds.toFixed(3)},setpts=PTS-STARTPTS[${sceneLabel}]`,
    ];
  }

  return [`${trim}[${sceneLabel}]`];
}

/**
 * Assembles every scene's footage, held or trimmed to its narration's
 * length (see `timeline.ts`), and crossfades consecutive scenes with
 * `xfade`. `xfade`'s `offset` is where the transition begins on its first
 * input's own timeline — chaining it pairwise, that is exactly each
 * scene's `startOffsetSeconds`, which is how `timeline.ts` derived that
 * field in the first place. A single-beat plan has nothing to crossfade
 * and reduces to the one scene, straight through.
 */
export function buildVideoGraph(timeline: Timeline, format: FormatPlan, startInputIndex = 0): FilterGraphSegment {
  const inputPaths = timeline.scenes.map((scene) => scene.footagePath);
  const filterLines: string[] = [];

  timeline.scenes.forEach((scene, index) => {
    filterLines.push(...sceneVideoFilterLines(scene, index, startInputIndex + index, format));
  });

  let currentLabel = "scene0";
  for (let index = 1; index < timeline.scenes.length; index += 1) {
    const scene = timeline.scenes[index];
    if (!scene) {
      continue;
    }
    const nextLabel = `x${index}`;
    filterLines.push(
      `[${currentLabel}][scene${index}]xfade=transition=fade:duration=${timeline.transitionSeconds.toFixed(3)}:offset=${scene.startOffsetSeconds.toFixed(3)}[${nextLabel}]`,
    );
    currentLabel = nextLabel;
  }

  return {
    inputPaths,
    startInputIndex,
    filterLines,
    outputLabel: currentLabel,
  };
}

/**
 * Escapes a filesystem path for use as a quoted ffmpeg filter option value.
 * The `subtitles`/`ass` filter's `filename` is parsed twice — once by
 * ffmpeg's filtergraph syntax, once internally — so even a single-quoted
 * value needs its own backslashes and quotes escaped to survive both
 * passes intact.
 */
export function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:");
}

/**
 * Burns the given `.ass` file into the assembled video. This is the last
 * video filter: everything upstream (`buildVideoGraph`) already produced a
 * single full-canvas stream, so `subtitles` only has to draw on top of it.
 */
export function applyCaptionsBurnIn(videoSegment: FilterGraphSegment, assPath: string): FilterGraphSegment {
  const outputLabel = "vout";
  const filterLine = `[${videoSegment.outputLabel}]subtitles=filename='${escapeFilterPath(assPath)}'[${outputLabel}]`;
  return {
    inputPaths: videoSegment.inputPaths,
    startInputIndex: videoSegment.startInputIndex,
    filterLines: [...videoSegment.filterLines, filterLine],
    outputLabel,
  };
}
