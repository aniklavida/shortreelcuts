/**
 * Support for `render.e2e.test.ts`: loading the hand-written plan fixture,
 * and synthesizing the media it points at.
 *
 * `hand-written-plan.json` is committed — a human can read it, edit it and
 * re-render it, which is the whole point of proving compose against a
 * plan nobody generated. The media it refers to is not committed: no
 * footage, voice or music provider exists yet (this card proves the
 * renderer, not sourcing), so there is nothing real to check in, and
 * `.gitignore` already keeps rendered media and audio out of the repo.
 * Instead this file synthesizes stand-ins with ffmpeg's own `lavfi`
 * generators — solid colour clips in place of footage, sine tones in
 * place of a voice and a music bed — deterministically, from the numbers
 * below, so the same fixture plan always gets the same inputs.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePlan, type Plan } from "@shortreelcuts/plan";
import { runFfmpeg } from "../process.js";
import type { ResolvedMedia } from "../types.js";

const PLAN_PATH = fileURLToPath(new URL("./hand-written-plan.json", import.meta.url));

export async function loadHandWrittenPlan(): Promise<Plan> {
  const raw = await readFile(PLAN_PATH, "utf8");
  return parsePlan(JSON.parse(raw));
}

/**
 * One row per beat in `hand-written-plan.json`. `footageSourceSeconds` is
 * this fixture's stand-in source file length, chosen to be shorter than,
 * longer than and equal to its beat's narration on purpose (see the
 * `reason` fields in the plan JSON) — the same three cases
 * `timeline.test.ts` covers in isolation, exercised here through a real
 * ffmpeg render.
 */
const BEAT_MEDIA = {
  b1: { colorHex: "0x2e7d32", footageSourceSeconds: 3.0, narrationSeconds: 3.0, toneHz: 220 },
  b2: { colorHex: "0x8d6e63", footageSourceSeconds: 2.3, narrationSeconds: 3.6, toneHz: 330 },
  b3: { colorHex: "0xffb300", footageSourceSeconds: 5.0, narrationSeconds: 2.4, toneHz: 440 },
} as const satisfies Record<string, { colorHex: string; footageSourceSeconds: number; narrationSeconds: number; toneHz: number }>;

const MUSIC_BED = { toneHz: 110, loopSeconds: 2.0 };

async function makeColorClip(path: string, colorHex: string, durationSeconds: number, ffmpegPath: string): Promise<void> {
  await runFfmpeg(ffmpegPath, [
    "-f",
    "lavfi",
    "-i",
    `color=c=${colorHex}:s=1080x1920:r=30:d=${durationSeconds}`,
    "-pix_fmt",
    "yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    path,
  ]);
}

async function makeToneClip(path: string, frequencyHz: number, durationSeconds: number, ffmpegPath: string): Promise<void> {
  await runFfmpeg(ffmpegPath, [
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${frequencyHz}:duration=${durationSeconds}:sample_rate=44100`,
    "-ac",
    "2",
    path,
  ]);
}

/**
 * Writes synthetic footage, narration and music files under `outDir` for
 * every beat `hand-written-plan.json` refers to, and returns the
 * `ResolvedMedia` that points at them.
 */
export async function synthesizeFixtureMedia(outDir: string, ffmpegPath: string): Promise<ResolvedMedia> {
  const footage: Record<string, string> = {};
  const narration: Record<string, string> = {};

  for (const [beatId, spec] of Object.entries(BEAT_MEDIA)) {
    const footagePath = join(outDir, `${beatId}-footage.mp4`);
    const narrationPath = join(outDir, `${beatId}-narration.wav`);
    await Promise.all([
      makeColorClip(footagePath, spec.colorHex, spec.footageSourceSeconds, ffmpegPath),
      makeToneClip(narrationPath, spec.toneHz, spec.narrationSeconds, ffmpegPath),
    ]);
    footage[beatId] = footagePath;
    narration[beatId] = narrationPath;
  }

  const musicPath = join(outDir, "music-bed.wav");
  await makeToneClip(musicPath, MUSIC_BED.toneHz, MUSIC_BED.loopSeconds, ffmpegPath);

  return { footage, narration, music: musicPath };
}
