/**
 * The compose stage's entry point: `render(plan, media, options)` turns a
 * validated `Plan` and its resolved media into an MP4. This is the only
 * file in the package that touches the filesystem or spawns `ffmpeg`;
 * everything upstream (`timeline.ts`, `captions.ts`, `filtergraph.ts`) is
 * pure and already unit-tested without it.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { Plan } from "@shortreelcuts/plan";
import { assertCaptionSupport, resolveFfmpegPath, resolveFfprobePath } from "./binaries.js";
import { renderAss, renderSrt } from "./captions.js";
import { applyCaptionsBurnIn, buildAudioGraph, buildVideoGraph } from "./filtergraph.js";
import { probeMedia } from "./probe.js";
import { runFfmpeg } from "./process.js";
import { buildTimeline, DEFAULT_TRANSITION_SECONDS } from "./timeline.js";
import { requireBeatCoverage, type RenderOptions, type ResolvedMedia, type VideoFile } from "./types.js";

/**
 * ~6 Mbps average for 1080×1920 at 30fps: the same pixel count as
 * 1920×1080, so a bitrate in the same range platforms already recommend
 * for that resolution reads as clean, without doubling file size for no
 * visible gain on a phone screen.
 */
const DEFAULT_VIDEO_BITRATE = "6M";

function withoutExtension(path: string): string {
  return basename(path, extname(path));
}

export async function render(plan: Plan, media: ResolvedMedia, options: RenderOptions): Promise<VideoFile> {
  requireBeatCoverage(plan, media);

  const ffmpegPath = resolveFfmpegPath(options.ffmpegPath);
  const ffprobePath = resolveFfprobePath(options.ffprobePath);
  await assertCaptionSupport(ffmpegPath);

  const narrationSeconds: Record<string, number> = {};
  const footageSeconds: Record<string, number> = {};
  for (const beat of plan.script.beats) {
    const narrationPath = media.narration[beat.id];
    const footagePath = media.footage[beat.id];
    // requireBeatCoverage already guaranteed these exist.
    const [narrationProbe, footageProbe] = await Promise.all([
      probeMedia(narrationPath as string, ffprobePath),
      probeMedia(footagePath as string, ffprobePath),
    ]);
    if (!narrationProbe.hasAudio) {
      throw new Error(`narration file for beat "${beat.id}" has no audio stream: ${narrationPath}`);
    }
    if (!footageProbe.hasVideo) {
      throw new Error(`footage file for beat "${beat.id}" has no video stream: ${footagePath}`);
    }
    narrationSeconds[beat.id] = narrationProbe.durationSeconds;
    footageSeconds[beat.id] = footageProbe.durationSeconds;
  }

  const transitionSeconds = options.transitionSeconds ?? DEFAULT_TRANSITION_SECONDS;
  const timeline = buildTimeline(
    plan,
    media,
    { narrationSeconds, footageSeconds },
    transitionSeconds,
  );

  const workDir = options.workDir ?? dirname(options.outputPath);
  await mkdir(workDir, { recursive: true });
  const stem = withoutExtension(options.outputPath);
  const assPath = join(workDir, `${stem}.ass`);
  const srtPath = options.srtPath ?? join(workDir, `${stem}.srt`);

  await writeFile(assPath, renderAss(timeline.cues, plan.captions, plan.format), "utf8");
  await writeFile(srtPath, renderSrt(timeline.cues), "utf8");

  const videoGraph = applyCaptionsBurnIn(buildVideoGraph(timeline, plan.format, 0), assPath);
  const audioGraph = buildAudioGraph(timeline, plan.music, media.music, videoGraph.inputPaths.length);

  const inputArgs = [...videoGraph.inputPaths, ...audioGraph.inputPaths].flatMap((path) => ["-i", path]);
  const filterComplex = [...videoGraph.filterLines, ...audioGraph.filterLines].join(";");
  const videoBitrate = options.videoBitrate ?? DEFAULT_VIDEO_BITRATE;

  const args = [
    ...inputArgs,
    "-filter_complex",
    filterComplex,
    "-map",
    `[${videoGraph.outputLabel}]`,
    "-map",
    `[${audioGraph.outputLabel}]`,
    "-t",
    timeline.totalDurationSeconds.toFixed(3),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-profile:v",
    "high",
    "-preset",
    "medium",
    "-b:v",
    videoBitrate,
    "-r",
    String(plan.format.fps),
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    options.outputPath,
  ];

  await runFfmpeg(ffmpegPath, args);

  const output = await probeMedia(options.outputPath, ffprobePath);

  return {
    path: options.outputPath,
    captionsPath: srtPath,
    width: plan.format.width,
    height: plan.format.height,
    fps: plan.format.fps,
    durationSeconds: output.durationSeconds,
  };
}
