/**
 * Timeline → an ffmpeg filter graph. Pure string-building: given a
 * `Timeline` (already measured and offset by `timeline.ts`) and the plan's
 * output format, this decides the exact `-filter_complex` ffmpeg will run.
 * Nothing here touches the filesystem or spawns a process — `run.ts` does
 * that with what this file returns.
 */
import type { FormatPlan, MusicPlan } from "@shortreelcuts/plan";
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

/**
 * Places each scene's narration at its `startOffsetSeconds` and mixes a
 * ducked background bed underneath it — the audio half of the filter
 * graph, built independently of `buildVideoGraph` but over the same
 * `Timeline` so both stay in lock-step with the same offsets.
 *
 * Ducking uses `sidechaincompress`: the narration mix drives a compressor
 * on the music bed, so the music actually quiets down while someone is
 * speaking and recovers in the gaps, rather than sitting at one hand-tuned
 * volume for the whole video. That is a real compressor, not a hand-rolled
 * volume envelope — deterministic for a fixed pair of inputs, and it reads
 * as ducking because it is ducking.
 */
export function buildAudioGraph(
  timeline: Timeline,
  music: MusicPlan,
  musicPath: string | undefined,
  startInputIndex = 0,
): FilterGraphSegment {
  const narrationPaths = timeline.scenes.map((scene) => scene.narrationPath);
  const filterLines: string[] = [];

  timeline.scenes.forEach((scene, index) => {
    const inputIndex = startInputIndex + index;
    const delayMs = Math.max(0, Math.round(scene.startOffsetSeconds * 1000));
    filterLines.push(
      `[${inputIndex}:a]aformat=sample_rates=44100:channel_layouts=stereo,adelay=${delayMs}|${delayMs}[narr${index}]`,
    );
  });

  const narrationLabels = timeline.scenes.map((_, index) => `[narr${index}]`).join("");
  filterLines.push(`${narrationLabels}amix=inputs=${timeline.scenes.length}:duration=longest:normalize=0[narrmix]`);

  if (!music.enabled) {
    filterLines.push("[narrmix]anull[aout]");
    return { inputPaths: narrationPaths, startInputIndex, filterLines, outputLabel: "aout" };
  }

  if (!musicPath) {
    throw new Error("music is enabled but no music file path was given to buildAudioGraph");
  }

  // A labelled pad can only feed one filter — `narrmix` is needed twice
  // (as the sidechain's trigger and again in the final mix), so it has to
  // be split rather than referenced twice.
  filterLines.push("[narrmix]asplit=2[narrmixsidechain][narrmixout]");

  const musicInputIndex = startInputIndex + timeline.scenes.length;
  filterLines.push(
    `[${musicInputIndex}:a]aformat=sample_rates=44100:channel_layouts=stereo,` +
      `aloop=loop=-1:size=2e9,atrim=end=${timeline.totalDurationSeconds.toFixed(3)},asetpts=PTS-STARTPTS,` +
      `volume=${music.volume}[musicbase]`,
  );
  filterLines.push(
    "[musicbase][narrmixsidechain]sidechaincompress=threshold=0.05:ratio=8:attack=5:release=250:makeup=1[musicducked]",
  );
  filterLines.push("[narrmixout][musicducked]amix=inputs=2:duration=longest:normalize=0[aout]");

  return {
    inputPaths: [...narrationPaths, musicPath],
    startInputIndex,
    filterLines,
    outputLabel: "aout",
  };
}
