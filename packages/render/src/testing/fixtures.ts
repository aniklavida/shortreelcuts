/**
 * Support for `render.e2e.test.ts`: loading the hand-written plan fixture,
 * and synthesizing the media it points at.
 *
 * `hand-written-plan.json` is committed — a human can read it, edit it and
 * re-render it, which is the whole point of proving compose against a
 * plan nobody generated. The media it refers to is not committed: no
 * footage, voice or music provider exists yet — this package renders a
 * plan, it does not source media — so there is nothing real to check in,
 * and `.gitignore` already keeps rendered media and audio out of the repo.
 * Instead this file synthesizes stand-ins with ffmpeg's own `lavfi`
 * generators — solid colour clips in place of footage, sine tones in
 * place of a voice and a music bed — deterministically, from the numbers
 * below, so the same fixture plan always gets the same inputs.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate, type Plan } from "@shortreelcuts/plan";
import { runFfmpeg } from "../process.js";
import type { ResolvedMedia } from "../types.js";

const PLAN_PATH = fileURLToPath(new URL("./hand-written-plan.json", import.meta.url));

/**
 * `hand-written-plan.json` is committed at `planVersion` 1 on purpose — it
 * is the one real, on-disk `planVersion` 1 document in this repository, so
 * loading it through `migrate()` rather than `parsePlan()` proves the
 * `planVersion` 1 → 2 migration against a real fixture, not just an
 * in-memory one, every time this test runs. Rendering byte-identically
 * before and after the migration exists is what makes that safe
 * (`@shortreelcuts/plan`'s own migration tests cover the shape of the
 * migration itself).
 */
export async function loadHandWrittenPlan(): Promise<Plan> {
  const raw = await readFile(PLAN_PATH, "utf8");
  return migrate(JSON.parse(raw));
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

// Pinned to bitexact/single-threaded for the same reason run.ts's own
// ffmpeg invocation is: so re-running the fixture generator produces the
// same bytes, which is what lets a determinism check compare two full
// renders end to end rather than only the compose step in isolation.
const DETERMINISTIC_FLAGS = [
  "-fflags",
  "+bitexact",
  "-flags:v",
  "+bitexact",
  "-flags:a",
  "+bitexact",
  "-filter_threads",
  "1",
];

async function makeColorClip(
  path: string,
  colorHex: string,
  durationSeconds: number,
  size: { width: number; height: number },
  ffmpegPath: string,
): Promise<void> {
  await runFfmpeg(ffmpegPath, [
    ...DETERMINISTIC_FLAGS,
    "-f",
    "lavfi",
    "-i",
    `color=c=${colorHex}:s=${size.width}x${size.height}:r=30:d=${durationSeconds}`,
    "-pix_fmt",
    "yuv420p",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-preset",
    "ultrafast",
    path,
  ]);
}

async function makeToneClip(path: string, frequencyHz: number, durationSeconds: number, ffmpegPath: string): Promise<void> {
  await runFfmpeg(ffmpegPath, [
    ...DETERMINISTIC_FLAGS,
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
 * `ResolvedMedia` that points at them. Footage is synthesized at `size`
 * (default 1080×1920, matching the fixture plan's own format) so a test
 * that renders a different shape can source footage of that shape rather
 * than relying on `compose`'s scale/crop alone.
 */
export async function synthesizeFixtureMedia(
  outDir: string,
  ffmpegPath: string,
  size: { width: number; height: number } = { width: 1080, height: 1920 },
): Promise<ResolvedMedia> {
  const footage: Record<string, string> = {};
  const narration: Record<string, string> = {};

  for (const [beatId, spec] of Object.entries(BEAT_MEDIA)) {
    const footagePath = join(outDir, `${beatId}-footage.mp4`);
    const narrationPath = join(outDir, `${beatId}-narration.wav`);
    await Promise.all([
      makeColorClip(footagePath, spec.colorHex, spec.footageSourceSeconds, size, ffmpegPath),
      makeToneClip(narrationPath, spec.toneHz, spec.narrationSeconds, ffmpegPath),
    ]);
    footage[beatId] = footagePath;
    narration[beatId] = narrationPath;
  }

  const musicPath = join(outDir, "music-bed.wav");
  await makeToneClip(musicPath, MUSIC_BED.toneHz, MUSIC_BED.loopSeconds, ffmpegPath);

  return { footage, narration, music: musicPath };
}
