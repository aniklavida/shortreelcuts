/**
 * Stand-in media for the four stub stages, so the one real stage —
 * compose — has actual files to render instead of a mock.
 *
 * `@shortreelcuts/render` renders real bytes; it has no opinion about
 * where footage or narration come from (that is `ResolvedMedia`'s job,
 * per its own `types.ts`). Since no footage or voice provider exists,
 * this synthesizes deterministic solid-colour clips and sine-tone audio
 * with `ffmpeg`'s own `lavfi` generators — the same technique
 * `packages/render`'s own end-to-end test fixture uses to prove compose,
 * written fresh here for the sheet's arbitrary (not fixed-3-beat) plans.
 *
 * This is a stand-in for un-built stages, not a mock of the renderer:
 * every file this writes is real media, and `render()` genuinely encodes
 * it with real `ffmpeg`.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Plan } from "@shortreelcuts/plan";
import { resolveFfmpegPath, runFfmpeg, type ResolvedMedia } from "@shortreelcuts/render";

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

function colorFor(beatId: string): string {
  let hash = 0;
  for (const ch of beatId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `0x${(hash & 0xffffff).toString(16).padStart(6, "0")}`;
}

function toneFor(beatId: string): number {
  let hash = 0;
  for (const ch of beatId) hash = (hash * 17 + ch.charCodeAt(0)) >>> 0;
  return 180 + (hash % 220); // an audible, distinct-ish tone per beat, 180-400Hz
}

function narrationSecondsFor(plan: Plan, beatId: string): number {
  const words = plan.align.words[beatId] ?? [];
  const last = words[words.length - 1];
  return Math.max(1.0, last?.endSeconds ?? 1.0);
}

async function makeColorClip(path: string, colorHex: string, durationSeconds: number, ffmpegPath: string): Promise<void> {
  await runFfmpeg(ffmpegPath, [
    ...DETERMINISTIC_FLAGS,
    "-f",
    "lavfi",
    "-i",
    `color=c=${colorHex}:s=1080x1920:r=30:d=${durationSeconds.toFixed(3)}`,
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
    `sine=frequency=${frequencyHz}:duration=${durationSeconds.toFixed(3)}:sample_rate=44100`,
    "-ac",
    "2",
    path,
  ]);
}

/**
 * Writes synthetic footage + narration for every beat in `plan`, plus a
 * music bed when `plan.music.enabled`, under `workDir`. Deterministic:
 * the same plan always synthesizes the same stand-in files.
 */
export async function synthesizeStubMedia(plan: Plan, workDir: string, ffmpegPathOverride?: string): Promise<ResolvedMedia> {
  await mkdir(workDir, { recursive: true });
  const ffmpegPath = resolveFfmpegPath(ffmpegPathOverride);

  const footage: Record<string, string> = {};
  const narration: Record<string, string> = {};

  for (const beat of plan.script.beats) {
    const narrationSeconds = narrationSecondsFor(plan, beat.id);
    const footageSeconds = narrationSeconds + 1.0; // extra room so compose can hold/trim, same shape as render's own fixture
    const footagePath = join(workDir, `${beat.id}-footage.mp4`);
    const narrationPath = join(workDir, `${beat.id}-narration.wav`);
    await Promise.all([
      makeColorClip(footagePath, colorFor(beat.id), footageSeconds, ffmpegPath),
      makeToneClip(narrationPath, toneFor(beat.id), narrationSeconds, ffmpegPath),
    ]);
    footage[beat.id] = footagePath;
    narration[beat.id] = narrationPath;
  }

  let music: string | undefined;
  if (plan.music.enabled) {
    const musicPath = join(workDir, "music-bed.wav");
    const totalSeconds = plan.script.beats.reduce((sum, b) => sum + narrationSecondsFor(plan, b.id), 0) + 2;
    await makeToneClip(musicPath, 110, totalSeconds, ffmpegPath);
    music = musicPath;
  }

  return music ? { footage, narration, music } : { footage, narration };
}
