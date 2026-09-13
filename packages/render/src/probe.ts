/**
 * Measuring real media with `ffprobe`, instead of trusting a plan's
 * decisions about how long something is.
 *
 * `plan.footage[beat].out - .in` is a decision the footage stage made; it
 * is not a guarantee that the source file is actually that long. Compose
 * measures the real files before it builds a timeline from them, because
 * the failure this package exists to avoid — captions drifting from audio
 * — is exactly what happens if a clip turns out shorter than the plan
 * assumed and nothing accounts for it.
 */
import { runFfprobe } from "./process.js";

export interface ProbedMedia {
  readonly durationSeconds: number;
  readonly width?: number;
  readonly height?: number;
  readonly hasVideo: boolean;
  readonly hasAudio: boolean;
}

interface FfprobeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  duration?: string;
}

interface FfprobeOutput {
  format?: { duration?: string };
  streams?: FfprobeStream[];
}

export async function probeMedia(path: string, ffprobePath: string): Promise<ProbedMedia> {
  const stdout = await runFfprobe(ffprobePath, [
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    path,
  ]);

  let data: FfprobeOutput;
  try {
    data = JSON.parse(stdout) as FfprobeOutput;
  } catch {
    throw new Error(`ffprobe returned output that was not valid JSON for "${path}"`);
  }

  const streams = data.streams ?? [];
  const videoStream = streams.find((stream) => stream.codec_type === "video");
  const audioStream = streams.find((stream) => stream.codec_type === "audio");

  const durationSource = data.format?.duration ?? videoStream?.duration ?? audioStream?.duration;
  const durationSeconds = Number(durationSource);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(`could not determine a positive duration for "${path}" via ffprobe`);
  }

  return {
    durationSeconds,
    ...(videoStream?.width !== undefined ? { width: videoStream.width } : {}),
    ...(videoStream?.height !== undefined ? { height: videoStream.height } : {}),
    hasVideo: Boolean(videoStream),
    hasAudio: Boolean(audioStream),
  };
}
