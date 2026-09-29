import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AlignedWord, AlignPlan, Plan } from "@shortreelcuts/plan";
import type { AlignRunInput, StageResult, StageRunners } from "./types.js";
import {
  alignScriptToTranscription,
  isWhisperAvailable,
  transcribeWithWhisper,
  type WhisperOptions,
} from "./whisper.js";

const SECONDS_PER_WORD = 0.32;

function timeWords(narration: string, rate: number): AlignedWord[] {
  const words = narration.split(/\s+/).filter((w) => w.length > 0);
  const perWord = SECONDS_PER_WORD / rate;
  let cursor = 0;
  return words.map((word) => {
    const startSeconds = cursor;
    const endSeconds = cursor + perWord;
    cursor = endSeconds;
    return { word, startSeconds, endSeconds };
  });
}

export async function runAlign(input: AlignRunInput): Promise<StageResult<Pick<Plan, "align">>> {
  const hasAudioSource = Boolean(
    input.audioFiles ||
      (input.mediaStore && (input.plan.voice?.mediaKeys || input.plan.voice?.tracks)),
  );

  if (!hasAudioSource) {
    const words: Record<string, AlignedWord[]> = {};
    for (const beat of input.plan.script.beats) {
      words[beat.id] = timeWords(beat.narration, input.plan.voice?.rate ?? 1.0);
    }
    const totalWords = Object.values(words).reduce((sum, w) => sum + w.length, 0);
    const align: AlignPlan = {
      provider: "stub-aligner",
      words,
      mediaKeys: input.plan.voice?.mediaKeys,
      reason: `${totalWords} words timed at ~${SECONDS_PER_WORD.toFixed(2)}s each, scaled by the chosen voice's rate — not a measurement of real audio yet`,
    };
    return { patch: { align }, candidates: {} };
  }

  const words: Record<string, AlignedWord[]> = {};
  let alignedWithWhisper = false;

  const whisperAvailable = isWhisperAvailable(input.whisperOptions);

  for (const beat of input.plan.script.beats) {
    let audioPath: string | undefined = input.audioFiles?.[beat.id];
    let cleanupFile: string | undefined;

    if (!audioPath && input.mediaStore) {
      const mediaKey =
        input.plan.voice?.mediaKeys?.[beat.id] ??
        input.plan.voice?.tracks?.find((t) => t.lineId === beat.id)?.mediaKey;
      if (mediaKey) {
        const bytes = await input.mediaStore.get(mediaKey);
        if (bytes && bytes.length > 0) {
          const workDir = input.workDir ?? join(process.cwd(), "media");
          await mkdir(workDir, { recursive: true });
          const tmpAudioPath = join(workDir, `align-${randomUUID()}-${beat.id}.wav`);
          await writeFile(tmpAudioPath, bytes);
          audioPath = tmpAudioPath;
          cleanupFile = tmpAudioPath;
        }
      }
    }

    if (audioPath && whisperAvailable) {
      try {
        const transcribedWords = await transcribeWithWhisper(audioPath, input.whisperOptions);
        const trackDuration =
          input.plan.voice?.tracks?.find((t) => t.lineId === beat.id)?.durationSeconds ??
          (transcribedWords.length > 0
            ? Math.max(1.0, transcribedWords[transcribedWords.length - 1]!.endSeconds)
            : beat.narration.split(/\s+/).length * (SECONDS_PER_WORD / (input.plan.voice?.rate ?? 1.0)));

        const aligned = alignScriptToTranscription(beat.narration, transcribedWords, trackDuration);
        words[beat.id] = aligned;
        // Only credit real acoustic alignment when whisper returned at least one token.
        // An empty transcription falls back to the same uniform estimate as the stub.
        if (transcribedWords.length > 0) {
          alignedWithWhisper = true;
        }
      } catch {
        words[beat.id] = timeWords(beat.narration, input.plan.voice?.rate ?? 1.0);
      } finally {
        if (cleanupFile && existsSync(cleanupFile)) {
          await unlink(cleanupFile).catch(() => undefined);
        }
      }
    } else {
      words[beat.id] = timeWords(beat.narration, input.plan.voice?.rate ?? 1.0);
    }
  }

  const totalWords = Object.values(words).reduce((sum, w) => sum + w.length, 0);

  const align: AlignPlan = alignedWithWhisper
    ? {
        provider: "whisper-cli",
        words,
        mediaKeys: input.plan.voice?.mediaKeys,
        reason: `${totalWords} words aligned against real speech audio via whisper-cli`,
      }
    : {
        provider: "stub-aligner",
        words,
        mediaKeys: input.plan.voice?.mediaKeys,
        reason: `${totalWords} words timed at ~${SECONDS_PER_WORD.toFixed(2)}s each, scaled by the chosen voice's rate — not a measurement of real audio yet`,
      };

  return { patch: { align }, candidates: {} };
}

export function createWhisperAlignRunner(options: WhisperOptions = {}): StageRunners["align"] {
  return async (input: AlignRunInput) => {
    return runAlign({ ...input, whisperOptions: options });
  };
}
