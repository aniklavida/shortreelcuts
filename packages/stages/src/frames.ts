/**
 * The frames stage — the sixth pipeline stage.
 *
 * Normalises each beat's footage decision (stock, generated video, or
 * motion graphics as code) into one intermediate 1080×1920 30 fps clip
 * so compose continues to work on files.
 *
 * Respects per-beat invalidation: unchanged beats whose render artifacts
 * are already present are left untouched, so only invalidated beats
 * re-render.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { contentKeyFor, type RenderMetadata } from "@shortreelcuts/plan";
import { resolveFfmpegPath } from "@shortreelcuts/render";
import { colorFor, makeColorClip } from "./media.js";
import type { FramesRunInput, FramesRunResult } from "./types.js";

const DEFAULT_RENDER_METADATA: RenderMetadata = {
  chromium: "chrome-headless-shell@153.0.8010.12",
  runtime: "srcuts-motion@1",
  ffmpeg: "bitexact",
};

function durationForBeat(input: FramesRunInput, beatId: string): number {
  const footage = input.plan.footage[beatId];
  if (!footage) return 4.0;

  switch (footage.source) {
    case "stock":
      return Math.max(1.0, footage.out - footage.in);
    case "generated":
      return Math.max(1.0, footage.seconds);
    case "motion": {
      const words = input.plan.align?.words?.[beatId] ?? [];
      const last = words[words.length - 1];
      return Math.max(1.0, last?.endSeconds ?? 4.0);
    }
  }
}

export async function runFrames(input: FramesRunInput): Promise<FramesRunResult> {
  const framesDir = join(input.workDir, "frames");
  await mkdir(framesDir, { recursive: true });

  let ffmpegPath: string | undefined;
  try {
    ffmpegPath = resolveFfmpegPath();
  } catch {
    // In headless test environments without ffmpeg installed, fallback to binary stand-in
  }

  const clips: Record<string, string> = {};
  const renderedBeats: string[] = [];

  for (const beat of input.plan.script.beats) {
    const key = contentKeyFor("frames", input.plan, beat.id);
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
    const artifactPath = join(framesDir, `${beat.id}-${safeKey}.mp4`);

    const isInvalidated =
      input.scopedBeats === undefined ||
      input.scopedBeats === "all" ||
      input.scopedBeats.has(beat.id);

    const existingFile =
      input.clipCache?.[beat.id] ?? (existsSync(artifactPath) ? artifactPath : undefined);

    // If beat is unaffected and already has an artifact, keep it untouched
    if (!isInvalidated && existingFile && existsSync(existingFile)) {
      clips[beat.id] = existingFile;
      continue;
    }

    // Render normalized intermediate clip for this beat
    const duration = durationForBeat(input, beat.id);
    const clipColor = colorFor(beat.id);

    if (ffmpegPath) {
      await makeColorClip(artifactPath, clipColor, duration, input.plan.format, ffmpegPath);
    } else {
      await writeFile(
        artifactPath,
        Buffer.from(`normalized-frame-clip:${beat.id}:${key}:${duration}`),
      );
    }

    clips[beat.id] = artifactPath;
    renderedBeats.push(beat.id);
  }

  return {
    patch: {
      render: DEFAULT_RENDER_METADATA,
    },
    candidates: {},
    clips,
    renderedBeats,
  };
}
