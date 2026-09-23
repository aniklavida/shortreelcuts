/**
 * The proof this package exists for: render the hand-written plan fixture
 * with a real ffmpeg and check the actual output file, not just the pure
 * code that describes it. STRUCTURE.md calls this out as its own, slower
 * suite deliberately kept separate from the rest of this package's tests
 * — most of which run with no ffmpeg at all.
 *
 * Opt in with `SHORTREELCUTS_RENDER_E2E=1` (see the root `test:e2e`
 * script). Skipped otherwise so `npm test` stays fast and does not require
 * ffmpeg. Point `SHORTREELCUTS_FFMPEG_PATH` / `SHORTREELCUTS_FFPROBE_PATH`
 * at a build with libass if the system default lacks it — see
 * `binaries.ts`.
 */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FORMAT_PRESETS, type FormatPlan } from "@shortreelcuts/plan";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveFfmpegPath, resolveFfprobePath } from "../binaries.js";
import { runFfprobe } from "../process.js";
import { render } from "../run.js";
import { loadHandWrittenPlan, synthesizeFixtureMedia } from "./fixtures.js";

const RUN_E2E = process.env["SHORTREELCUTS_RENDER_E2E"] === "1";

interface FfprobeStream {
  codec_type: string;
  codec_name: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  channels?: number;
}
interface FfprobeOutput {
  format: { duration: string; format_name: string };
  streams: FfprobeStream[];
}

describe.skipIf(!RUN_E2E)("render() against the hand-written plan fixture", () => {
  let workDir: string;
  let outputPath: string;
  const ffmpegPath = resolveFfmpegPath();
  const ffprobePath = resolveFfprobePath();

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "shortreelcuts-render-e2e-"));
    outputPath = join(workDir, "hand-written-plan.mp4");
  }, 30_000);

  afterAll(async () => {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  it(
    "produces a playable, correctly-shaped MP4 with captions and mixed audio",
    async () => {
      const plan = await loadHandWrittenPlan();
      const media = await synthesizeFixtureMedia(workDir, ffmpegPath);

      const video = await render(plan, media, { outputPath, ffmpegPath, ffprobePath, transitionSeconds: 0.4 });

      // Expected total: scenes at 3.0s, 3.6s, 2.4s narration each, two 0.4s
      // crossfades: 3.0 + 3.6 + 2.4 - 2*0.4 = 8.2s. See fixtures.ts / the
      // plan's own footage.*.reason fields for why each beat is shaped the
      // way it is.
      expect(video.durationSeconds).toBeGreaterThan(8.0);
      expect(video.durationSeconds).toBeLessThan(8.4);
      expect(video.width).toBe(1080);
      expect(video.height).toBe(1920);
      expect(video.fps).toBe(30);

      const probeJson = await runFfprobe(ffprobePath, [
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        outputPath,
      ]);
      const probed = JSON.parse(probeJson) as FfprobeOutput;

      expect(probed.format.format_name).toContain("mp4");
      expect(Number(probed.format.duration)).toBeGreaterThan(8.0);
      expect(Number(probed.format.duration)).toBeLessThan(8.4);

      const videoStream = probed.streams.find((stream) => stream.codec_type === "video");
      expect(videoStream?.codec_name).toBe("h264");
      expect(videoStream?.width).toBe(1080);
      expect(videoStream?.height).toBe(1920);
      expect(videoStream?.r_frame_rate).toBe("30/1");

      const audioStream = probed.streams.find((stream) => stream.codec_type === "audio");
      expect(audioStream?.codec_name).toBe("aac");
      expect(audioStream?.channels).toBe(2);

      // The .srt sidecar: 8 + 8 + 9 = 25 words at 3 per cue is 3 + 3 + 3 = 9 cues.
      const srt = await readFile(video.captionsPath, "utf8");
      const cueCount = srt.trim().split("\n\n").length;
      expect(cueCount).toBe(9);
      expect(srt).toContain("Bengal's tea gardens");
      expect(srt).toContain("00:00:00,000 -->");
    },
    60_000,
  );

  it(
    "renders a 16:9 plan at 1920x1080 and a 1:1 plan at 1080x1080",
    async () => {
      // The schema accepting a shape is not the same as the encoder emitting
      // it. This renders the real fixture plan at the two non-default shapes
      // and probes the finished file, so the assertion is on actual output
      // pixels — the footage crop/framing and the final dimensions both come
      // from `plan.format`.
      const basePlan = await loadHandWrittenPlan();
      const cases = [
        { ratio: "16:9" as const, width: 1920, height: 1080 },
        { ratio: "1:1" as const, width: 1080, height: 1080 },
      ];

      for (const { ratio, width, height } of cases) {
        const runDir = join(workDir, `format-${ratio.replace(":", "x")}`);
        await mkdir(runDir, { recursive: true });
        const format: FormatPlan = { ...FORMAT_PRESETS[ratio], fps: 30, container: "mp4" };
        const plan = { ...basePlan, format };
        const media = await synthesizeFixtureMedia(runDir, ffmpegPath, format);
        const runOutputPath = join(runDir, "out.mp4");

        const video = await render(plan, media, {
          outputPath: runOutputPath,
          ffmpegPath,
          ffprobePath,
          transitionSeconds: 0.4,
        });

        expect(video.width).toBe(width);
        expect(video.height).toBe(height);

        const probeJson = await runFfprobe(ffprobePath, [
          "-print_format",
          "json",
          "-show_format",
          "-show_streams",
          runOutputPath,
        ]);
        const probed = JSON.parse(probeJson) as FfprobeOutput;
        const videoStream = probed.streams.find((stream) => stream.codec_type === "video");
        expect(videoStream?.width).toBe(width);
        expect(videoStream?.height).toBe(height);
      }
    },
    120_000,
  );

  it(
    "renders the same plan to byte-identical output twice, media regenerated from scratch each time",
    async () => {
      // `docs/SPEC.md` §17: "re-rendering the same plan twice produces
      // byte-identical output" — not a given for free with a
      // real video encoder. run.ts pins ffmpeg to bitexact, single-threaded
      // encoding for exactly this; this test is what proves that choice
      // actually holds, end to end, rather than trusting the flags exist.
      const plan = await loadHandWrittenPlan();
      const hashes: string[] = [];

      for (const label of ["first", "second"]) {
        const runDir = join(workDir, label);
        await mkdir(runDir, { recursive: true });
        const media = await synthesizeFixtureMedia(runDir, ffmpegPath);
        const runOutputPath = join(runDir, "out.mp4");
        await render(plan, media, { outputPath: runOutputPath, ffmpegPath, ffprobePath, transitionSeconds: 0.4 });
        const bytes = await readFile(runOutputPath);
        hashes.push(createHash("sha256").update(bytes).digest("hex"));
      }

      expect(hashes[0]).toBe(hashes[1]);
    },
    60_000,
  );
});
