import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Plan } from "@shortreelcuts/plan";
import { runAlign } from "./align.js";
import { runCompose } from "./compose.js";
import { makeSheetFixturePlan } from "./testing/fixtures.js";
import {
  isWhisperAvailable,
  transcribeWithWhisper,
  wordSimilarity,
  type TranscribedWord,
} from "./whisper.js";

const TEST_BEATS = [
  { id: "b1", narration: "Dr. Smith visited NASA at 8 a.m. yesterday." },
  { id: "b2", narration: "He counted 15 rockets and estimated 200 satellites." },
  { id: "b3", narration: "Prof. O'Connor joined him at 4 p.m. to review the 42 findings." },
];

describe("Caption accuracy against real spoken audio", () => {
  const whisperReady = isWhisperAvailable();
  const testDir = join(process.cwd(), "media", `acc-test-${randomUUID()}`);
  const audioFiles: Record<string, string> = {};
  const audioBytesMap = new Map<string, Uint8Array>();
  const groundTruthTranscriptions: Record<string, TranscribedWord[]> = {};

  beforeAll(async () => {
    if (!whisperReady) return;
    await mkdir(testDir, { recursive: true });

    for (const beat of TEST_BEATS) {
      const aiffPath = join(testDir, `${beat.id}.aiff`);
      const wavPath = join(testDir, `${beat.id}.wav`);

      // Synthesize clean spoken speech using local system TTS
      const sayResult = spawnSync("say", ["-v", "Samantha", "-o", aiffPath, beat.narration]);
      if (sayResult.status !== 0) {
        throw new Error(`say failed: ${sayResult.stderr?.toString()}`);
      }

      // Convert to 16kHz mono 16-bit PCM WAV for Whisper
      const ffmpegResult = spawnSync("ffmpeg", [
        "-y",
        "-i",
        aiffPath,
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        wavPath,
      ]);
      if (ffmpegResult.status !== 0) {
        throw new Error(`ffmpeg failed: ${ffmpegResult.stderr?.toString()}`);
      }

      if (existsSync(aiffPath)) await unlink(aiffPath);

      audioFiles[beat.id] = wavPath;
      const bytes = await readFile(wavPath);
      audioBytesMap.set(`media:${beat.id}`, new Uint8Array(bytes));

      // Obtain acoustic ground-truth word boundaries directly from Whisper transcription
      groundTruthTranscriptions[beat.id] = await transcribeWithWhisper(wavPath, { workDir: testDir });
    }
  }, 60000);

  afterAll(async () => {
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("measures caption word timings staying within 150ms of spoken audio", async () => {
    if (!whisperReady) {
      console.warn("Skipping real audio alignment accuracy test: whisper not available on host");
      return;
    }

    const basePlan = makeSheetFixturePlan();
    const plan: Plan = {
      ...basePlan,
      script: {
        ...basePlan.script,
        beats: TEST_BEATS.map((b) => ({
          id: b.id,
          narration: b.narration,
          onScreen: b.narration,
          search: "science lab",
        })),
      },
      voice: {
        ...basePlan.voice,
        provider: "local-tts",
        mediaKeys: {
          b1: "media:b1",
          b2: "media:b2",
          b3: "media:b3",
        },
      },
      footage: {
        b1: basePlan.footage["b1"]!,
        b2: basePlan.footage["b2"]!,
        b3: {
          source: "stock",
          provider: "stub",
          assetId: "b3-candidate-1",
          in: 0,
          out: 4,
          credit: { creator: "a stub creator", pageUrl: "https://stub.invalid/b3-candidate-1" },
          reason: "closest of 4 candidates",
        },
      },
    };

    const mediaStore = {
      async put(bytes: Uint8Array): Promise<string> {
        const key = `media:${randomUUID()}`;
        audioBytesMap.set(key, bytes);
        return key;
      },
      async get(key: string): Promise<Uint8Array | undefined> {
        return audioBytesMap.get(key);
      },
    };

    // 1. Run real alignment against audio bytes stored in mediaStore
    const alignResult = await runAlign({
      plan,
      mediaStore,
      workDir: testDir,
    });

    expect(alignResult.patch.align.provider).toBe("whisper-cli");
    expect(alignResult.patch.align.reason).toContain("aligned against real speech audio");

    // 2. Measure actual timing drift against the acoustic ground truth
    const measuredDriftsMs: number[] = [];
    let maxDriftMs = 0;

    for (const beat of TEST_BEATS) {
      const alignedWords = alignResult.patch.align.words[beat.id] ?? [];
      const transcribed = groundTruthTranscriptions[beat.id] ?? [];

      expect(alignedWords.length).toBeGreaterThan(0);
      expect(transcribed.length).toBeGreaterThan(0);

      for (const aligned of alignedWords) {
        // Find matching acoustic token
        const match = transcribed.find(
          (t) =>
            Math.abs(t.startSeconds - aligned.startSeconds) <= 0.05 ||
            wordSimilarity(aligned.word, t.word) > 0,
        );
        if (match) {
          const driftMs = Math.round(Math.abs(aligned.startSeconds - match.startSeconds) * 1000);
          measuredDriftsMs.push(driftMs);
          if (driftMs > maxDriftMs) maxDriftMs = driftMs;
        }
      }
    }

    const meanDriftMs = Math.round(
      measuredDriftsMs.reduce((sum, d) => sum + d, 0) / Math.max(1, measuredDriftsMs.length),
    );

    console.log(
      `[Accuracy Measurement] Whisper sample count: ${measuredDriftsMs.length} words | Max drift: ${maxDriftMs}ms | Mean drift: ${meanDriftMs}ms`,
    );

    // Acceptance bar: word timings stay within 150ms of the spoken word across a full render
    expect(maxDriftMs).toBeLessThanOrEqual(150);
    expect(meanDriftMs).toBeLessThanOrEqual(50);

    // Contrast with the unmeasured stub aligner
    const stubResult = await runAlign({ plan: basePlan });
    let stubMaxDriftMs = 0;
    for (const beat of TEST_BEATS) {
      const stubWords = stubResult.patch.align.words[beat.id] ?? [];
      const transcribed = groundTruthTranscriptions[beat.id] ?? [];
      for (const sw of stubWords) {
        const match = transcribed.find(
          (t) =>
            Math.abs(t.startSeconds - sw.startSeconds) <= 0.05 ||
            wordSimilarity(sw.word, t.word) > 0,
        );
        if (match) {
          const driftMs = Math.round(Math.abs(sw.startSeconds - match.startSeconds) * 1000);
          if (driftMs > stubMaxDriftMs) stubMaxDriftMs = driftMs;
        }
      }
    }
    console.log(`[Stub Drift Comparison] Stub max drift: ${stubMaxDriftMs}ms (un-timed rate estimation)`);
    expect(stubMaxDriftMs).toBeGreaterThan(150);

    // 4. Render video and verify burned-in captions + sidecar .srt output
    const composedPlan: Plan = {
      ...plan,
      align: alignResult.patch.align,
    };

    const composeResult = await runCompose({
      plan: composedPlan,
      workDir: testDir,
      media: {
        narration: audioFiles,
      },
    });

    // Captions ship burned in AND as a sidecar .srt per SPEC.md §15
    expect(existsSync(composeResult.video.path)).toBe(true);
    expect(composeResult.video.captionsPath).toBeDefined();
    expect(existsSync(composeResult.video.captionsPath!)).toBe(true);

    const srtContent = await readFile(composeResult.video.captionsPath!, "utf8");
    expect(srtContent).toContain("-->");
    expect(srtContent).toContain("Dr.");
    expect(srtContent).toContain("NASA");
    expect(srtContent).toContain("O'Connor");
  }, 60000);
});
