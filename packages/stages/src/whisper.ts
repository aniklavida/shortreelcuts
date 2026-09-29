/**
 * Whisper-family transcription runtime as a separate process.
 *
 * Spawns `whisper-cli` (never linked as a library) to transcribe speech audio
 * and extract acoustic word-level timestamps.
 *
 * Word timings are matched to the script narration using monotonic sequence
 * alignment with explicit normalization for numbers, names and abbreviations.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AlignedWord } from "@shortreelcuts/plan";

export interface TranscribedWord {
  readonly word: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
}

export interface WhisperOptions {
  readonly whisperPath?: string;
  readonly modelPath?: string;
  readonly workDir?: string;
}

export class AlignmentError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "AlignmentError";
    this.cause = cause;
  }
}

export function resolveWhisperBinaryPath(override?: string): string {
  if (override) return override;
  if (process.env["SHORTREELCUTS_WHISPER_PATH"]) return process.env["SHORTREELCUTS_WHISPER_PATH"];
  if (process.env["WHISPER_BINARY_PATH"]) return process.env["WHISPER_BINARY_PATH"];

  const candidates = [
    "/opt/homebrew/bin/whisper-cli",
    "/usr/local/bin/whisper-cli",
    "/opt/homebrew/bin/whisper-cpp",
    "/usr/local/bin/whisper-cpp",
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return "whisper-cli";
}

export function resolveWhisperModelPath(override?: string): string | undefined {
  if (override) return override;
  if (process.env["SHORTREELCUTS_WHISPER_MODEL"]) return process.env["SHORTREELCUTS_WHISPER_MODEL"];
  if (process.env["WHISPER_MODEL"]) return process.env["WHISPER_MODEL"];

  const candidates = [
    "/opt/homebrew/share/whisper-cpp/models/ggml-base.bin",
    "/usr/local/share/whisper-cpp/models/ggml-base.bin",
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

const binaryAvailableCache = new Map<string, boolean>();

export function isWhisperBinaryAvailable(binaryPath?: string): boolean {
  const binary = binaryPath ?? resolveWhisperBinaryPath();
  const cached = binaryAvailableCache.get(binary);
  if (cached !== undefined) return cached;
  try {
    const result = spawnSync(binary, ["--help"], { stdio: "ignore" });
    const available = result.error === undefined && result.status === 0;
    binaryAvailableCache.set(binary, available);
    return available;
  } catch {
    binaryAvailableCache.set(binary, false);
    return false;
  }
}

export function isWhisperAvailable(options: WhisperOptions = {}): boolean {
  const binary = resolveWhisperBinaryPath(options.whisperPath);
  const model = resolveWhisperModelPath(options.modelPath);
  return Boolean(model && existsSync(model) && isWhisperBinaryAvailable(binary));
}

export async function transcribeWithWhisper(
  audioPath: string,
  options: WhisperOptions = {},
): Promise<TranscribedWord[]> {
  const binary = resolveWhisperBinaryPath(options.whisperPath);
  const model = resolveWhisperModelPath(options.modelPath);
  if (!model || !existsSync(model)) {
    throw new AlignmentError(`Whisper model not found at "${model ?? "undefined"}". Set SHORTREELCUTS_WHISPER_MODEL.`);
  }

  const workDir = options.workDir ?? dirname(audioPath);
  await mkdir(workDir, { recursive: true });
  const outPrefix = join(workDir, `whisper-${randomUUID()}`);
  const outJsonPath = `${outPrefix}.json`;

  const args = [
    "-m",
    model,
    "-f",
    audioPath,
    "-ml",
    "1",
    "-sow",
    "-oj",
    "-of",
    outPrefix,
    "-np",
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      reject(new AlignmentError(`Failed to spawn ${binary}: ${err.message}`, err));
    });
    child.on("close", (code) => {
      if (code === 0 && existsSync(outJsonPath)) {
        resolve();
      } else {
        reject(new AlignmentError(`whisper-cli failed with exit code ${code}: ${stderr}`));
      }
    });
  });

  try {
    const content = await readFile(outJsonPath, "utf8");
    const parsed = JSON.parse(content) as {
      transcription?: Array<{
        text?: string;
        offsets?: { from?: number; to?: number };
      }>;
    };
    const transcription = parsed.transcription ?? [];
    const words: TranscribedWord[] = [];
    for (const item of transcription) {
      const text = (item.text ?? "").trim();
      if (!text) continue;
      const startSeconds = (item.offsets?.from ?? 0) / 1000;
      let endSeconds = (item.offsets?.to ?? 0) / 1000;
      if (endSeconds <= startSeconds) {
        endSeconds = startSeconds + 0.05;
      }
      words.push({ word: text, startSeconds, endSeconds });
    }
    return words;
  } finally {
    if (existsSync(outJsonPath)) {
      await rm(outJsonPath, { force: true });
    }
  }
}

function cleanWord(w: string): string {
  return w.toLowerCase().replace(/^[^\w\d]+|[^\w\d]+$/g, "");
}

const ABBREVIATIONS: Readonly<Record<string, string>> = {
  dr: "doctor",
  doctor: "doctor",
  mr: "mister",
  mister: "mister",
  mrs: "missus",
  missus: "missus",
  ms: "ms",
  prof: "professor",
  professor: "professor",
  st: "saint",
  saint: "saint",
  am: "am",
  "a.m": "am",
  pm: "pm",
  "p.m": "pm",
  nasa: "nasa",
  usa: "usa",
  km: "kilometers",
  kilometers: "kilometers",
  vs: "versus",
  etc: "etcetera",
};

const NUMBER_WORDS: Readonly<Record<number, string>> = {
  0: "zero",
  1: "one",
  2: "two",
  3: "three",
  4: "four",
  5: "five",
  6: "six",
  7: "seven",
  8: "eight",
  9: "nine",
  10: "ten",
  11: "eleven",
  12: "twelve",
  13: "thirteen",
  14: "fourteen",
  15: "fifteen",
  16: "sixteen",
  17: "seventeen",
  18: "eighteen",
  19: "nineteen",
  20: "twenty",
  30: "thirty",
  40: "forty",
  50: "fifty",
  60: "sixty",
  70: "seventy",
  80: "eighty",
  90: "ninety",
  100: "hundred",
  1000: "thousand",
};

function numToWords(n: number): string[] {
  if (n < 20) return [NUMBER_WORDS[n] ?? String(n)];
  if (n < 100) {
    const rem = n % 10;
    const tens = NUMBER_WORDS[Math.floor(n / 10) * 10];
    return rem && NUMBER_WORDS[rem] ? [tens ?? "", NUMBER_WORDS[rem]] : [tens ?? String(n)];
  }
  if (n < 1000) {
    const hundreds = Math.floor(n / 100);
    const rem = n % 100;
    const hWord = `${NUMBER_WORDS[hundreds] ?? String(hundreds)} hundred`;
    return rem ? [hWord, ...numToWords(rem)] : [hWord];
  }
  return [String(n)];
}

function normalizeSpokenNumberOrHomophone(w: string): string {
  return w
    .toLowerCase()
    .replace(/[:.'’\-]/g, "")
    .replace(/\bto\b/g, "two")
    .replace(/\btoo\b/g, "two")
    .replace(/\b100\b/g, "hundred")
    .replace(/\b200\b/g, "two hundred");
}

export function wordSimilarity(s: string, t: string): number {
  const sn = cleanWord(s);
  const tn = cleanWord(t);
  if (!sn || !tn) return 0;
  if (sn === tn) return 1.0;
  if (ABBREVIATIONS[sn] && ABBREVIATIONS[sn] === ABBREVIATIONS[tn]) return 1.0;
  if (ABBREVIATIONS[sn] === tn || sn === ABBREVIATIONS[tn]) return 1.0;
  if (sn.replace(/[:.'’\-]/g, "") === tn.replace(/[:.'’\-]/g, "")) return 1.0;

  const snNorm = normalizeSpokenNumberOrHomophone(s);
  const tnNorm = normalizeSpokenNumberOrHomophone(t);
  if (snNorm === tnNorm) return 1.0;

  const sNum = parseInt(sn, 10);
  if (!isNaN(sNum)) {
    const sWords = numToWords(sNum).join(" ");
    if (sWords === tn || sWords.replace(/\s+/g, "") === tn) return 1.0;
    if (sWords === tnNorm || sWords.replace(/\s+/g, "") === tnNorm.replace(/\s+/g, "")) return 1.0;
  }
  const tNum = parseInt(tn, 10);
  if (!isNaN(tNum)) {
    const tWords = numToWords(tNum).join(" ");
    if (tWords === sn || tWords.replace(/\s+/g, "") === sn) return 1.0;
    if (tWords === snNorm || tWords.replace(/\s+/g, "") === snNorm.replace(/\s+/g, "")) return 1.0;
  }

  if (sn.length >= 4 && tn.length >= 4) {
    let diff = 0;
    const minLen = Math.min(sn.length, tn.length);
    for (let i = 0; i < minLen; i++) {
      if (sn[i] !== tn[i]) diff++;
    }
    diff += Math.abs(sn.length - tn.length);
    if (diff <= 2) return 0.8;
  }

  return 0;
}

export function alignScriptToTranscription(
  scriptNarration: string,
  transcribedWords: readonly TranscribedWord[],
  totalDurationSeconds: number,
): AlignedWord[] {
  const scriptWords = scriptNarration.trim().split(/\s+/).filter((w) => w.length > 0);
  const N = scriptWords.length;
  const M = transcribedWords.length;
  if (N === 0) return [];
  if (M === 0) {
    const perWord = totalDurationSeconds / N;
    return scriptWords.map((w, i) => ({
      word: w,
      startSeconds: Number((i * perWord).toFixed(3)),
      endSeconds: Number(((i + 1) * perWord).toFixed(3)),
    }));
  }

  const dp: number[][] = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(-Infinity));
  const parent: (
    | { i: number; j: number; type: "match_1_1" | "match_1_2" | "match_2_1" | "skip_s" | "skip_t" }
    | null
  )[][] = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(null));

  dp[0]![0] = 0;

  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= M; j++) {
      const cur = dp[i]![j]!;
      if (cur === -Infinity) continue;

      if (j < M && cur - 0.5 > (dp[i]![j + 1] ?? -Infinity)) {
        dp[i]![j + 1] = cur - 0.5;
        parent[i]![j + 1] = { i, j, type: "skip_t" };
      }

      if (i < N && cur - 1.0 > (dp[i + 1]![j] ?? -Infinity)) {
        dp[i + 1]![j] = cur - 1.0;
        parent[i + 1]![j] = { i, j, type: "skip_s" };
      }

      if (i < N && j < M) {
        const sim = wordSimilarity(scriptWords[i]!, transcribedWords[j]!.word);
        if (sim > 0) {
          const score = cur + sim * 5;
          if (score > (dp[i + 1]![j + 1] ?? -Infinity)) {
            dp[i + 1]![j + 1] = score;
            parent[i + 1]![j + 1] = { i, j, type: "match_1_1" };
          }
        }
      }

      if (i < N && j + 1 < M) {
        const twoWords = `${transcribedWords[j]!.word} ${transcribedWords[j + 1]!.word}`;
        const sim = wordSimilarity(scriptWords[i]!, twoWords);
        if (sim > 0) {
          const score = cur + sim * 5;
          if (score > (dp[i + 1]![j + 2] ?? -Infinity)) {
            dp[i + 1]![j + 2] = score;
            parent[i + 1]![j + 2] = { i, j, type: "match_1_2" };
          }
        }
      }

      if (i + 1 < N && j < M) {
        const twoWords = `${scriptWords[i]!} ${scriptWords[i + 1]!}`;
        const sim = wordSimilarity(twoWords, transcribedWords[j]!.word);
        if (sim > 0) {
          const score = cur + sim * 5;
          if (score > (dp[i + 2]![j + 1] ?? -Infinity)) {
            dp[i + 2]![j + 1] = score;
            parent[i + 2]![j + 1] = { i, j, type: "match_2_1" };
          }
        }
      }
    }
  }

  const matches = new Map<number, { startSeconds: number; endSeconds: number }>();
  let curr: { i: number; j: number } | null = { i: N, j: M };
  while (curr && (curr.i > 0 || curr.j > 0)) {
    const p: { i: number; j: number; type: "match_1_1" | "match_1_2" | "match_2_1" | "skip_s" | "skip_t" } | null | undefined =
      parent[curr.i]?.[curr.j];
    if (!p) break;
    if (p.type === "match_1_1") {
      const tw = transcribedWords[p.j]!;
      matches.set(p.i, { startSeconds: tw.startSeconds, endSeconds: tw.endSeconds });
    } else if (p.type === "match_1_2") {
      const tw1 = transcribedWords[p.j]!;
      const tw2 = transcribedWords[p.j + 1]!;
      matches.set(p.i, { startSeconds: tw1.startSeconds, endSeconds: tw2.endSeconds });
    } else if (p.type === "match_2_1") {
      const tw = transcribedWords[p.j]!;
      const mid = Number(((tw.startSeconds + tw.endSeconds) / 2).toFixed(3));
      matches.set(p.i, { startSeconds: tw.startSeconds, endSeconds: mid });
      matches.set(p.i + 1, { startSeconds: mid, endSeconds: tw.endSeconds });
    }
    curr = { i: p.i, j: p.j };
  }

  const result: AlignedWord[] = [];
  let lastEnd = 0;

  for (let i = 0; i < N; i++) {
    const word = scriptWords[i]!;
    if (matches.has(i)) {
      const m = matches.get(i)!;
      const startSeconds = Math.max(lastEnd, m.startSeconds);
      const endSeconds = Math.max(startSeconds + 0.05, m.endSeconds);
      lastEnd = endSeconds;
      result.push({
        word,
        startSeconds: Number(startSeconds.toFixed(3)),
        endSeconds: Number(endSeconds.toFixed(3)),
      });
    } else {
      let nextStart = totalDurationSeconds;
      for (let k = i + 1; k < N; k++) {
        if (matches.has(k)) {
          nextStart = matches.get(k)!.startSeconds;
          break;
        }
      }
      const remainingUnmatched = Math.max(1, N - i);
      const slot = Math.max(0.08, (nextStart - lastEnd) / remainingUnmatched);
      const startSeconds = lastEnd;
      const endSeconds = Math.min(nextStart, startSeconds + slot);
      const validEnd = endSeconds > startSeconds ? endSeconds : startSeconds + 0.05;
      lastEnd = validEnd;
      result.push({
        word,
        startSeconds: Number(startSeconds.toFixed(3)),
        endSeconds: Number(validEnd.toFixed(3)),
      });
    }
  }

  return result;
}
