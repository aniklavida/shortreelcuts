import { describe, expect, it } from "vitest";
import {
  alignScriptToTranscription,
  isWhisperAvailable,
  isWhisperBinaryAvailable,
  resolveWhisperBinaryPath,
  resolveWhisperModelPath,
  wordSimilarity,
  type TranscribedWord,
} from "./whisper.js";

describe("wordSimilarity", () => {
  it("matches identical words case-insensitively with stripped punctuation", () => {
    expect(wordSimilarity("Hello", "hello")).toBe(1.0);
    expect(wordSimilarity("world!", "world")).toBe(1.0);
    expect(wordSimilarity('"quoted"', "quoted")).toBe(1.0);
  });

  it("matches abbreviations and their spoken equivalents", () => {
    expect(wordSimilarity("Dr.", "doctor")).toBe(1.0);
    expect(wordSimilarity("Doctor", "dr")).toBe(1.0);
    expect(wordSimilarity("Mr.", "mister")).toBe(1.0);
    expect(wordSimilarity("a.m.", "am")).toBe(1.0);
    expect(wordSimilarity("km", "kilometers")).toBe(1.0);
    expect(wordSimilarity("NASA", "nasa")).toBe(1.0);
    expect(wordSimilarity("USA", "usa")).toBe(1.0);
  });

  it("matches numbers between digit form and words", () => {
    expect(wordSimilarity("8", "eight")).toBe(1.0);
    expect(wordSimilarity("fifteen", "15")).toBe(1.0);
    expect(wordSimilarity("15", "fifteen")).toBe(1.0);
    expect(wordSimilarity("20", "twenty")).toBe(1.0);
    expect(wordSimilarity("twenty", "20")).toBe(1.0);
  });

  it("matches names with hyphens or apostrophes", () => {
    expect(wordSimilarity("O'Connor", "Oconnor")).toBe(1.0);
    expect(wordSimilarity("Smith", "Smith")).toBe(1.0);
    expect(wordSimilarity("Jean-Luc", "Jean-Luc")).toBe(1.0);
  });

  it("tolerates minor transcription variations in longer words", () => {
    expect(wordSimilarity("Jonathan", "Jonathon")).toBeGreaterThanOrEqual(0.8);
    expect(wordSimilarity("different", "unrelated")).toBe(0);
  });
});

describe("alignScriptToTranscription", () => {
  it("aligns words using acoustic transcription timestamps", () => {
    const script = "Doctor Smith arrived at 8 a.m. with 15 apples.";
    const transcribed: TranscribedWord[] = [
      { word: "Dr.", startSeconds: 0.01, endSeconds: 0.3 },
      { word: "Smith", startSeconds: 0.3, endSeconds: 0.61 },
      { word: "arrived", startSeconds: 0.61, endSeconds: 1.04 },
      { word: "at", startSeconds: 1.04, endSeconds: 1.29 },
      { word: "8", startSeconds: 1.29, endSeconds: 1.42 },
      { word: "a.m.", startSeconds: 1.42, endSeconds: 1.8 },
      { word: "with", startSeconds: 1.8, endSeconds: 2.05 },
      { word: "15", startSeconds: 2.05, endSeconds: 2.45 },
      { word: "apples.", startSeconds: 2.45, endSeconds: 3.1 },
    ];

    const aligned = alignScriptToTranscription(script, transcribed, 3.1);

    expect(aligned).toHaveLength(9);
    expect(aligned.map((a) => a.word)).toEqual(script.split(/\s+/));
    expect(aligned[0]!.startSeconds).toBe(0.01);
    expect(aligned[0]!.endSeconds).toBe(0.3);
    expect(aligned[1]!.startSeconds).toBe(0.3);
    expect(aligned[1]!.endSeconds).toBe(0.61);
    expect(aligned[4]!.word).toBe("8");
    expect(aligned[4]!.startSeconds).toBe(1.29);
    expect(aligned[7]!.word).toBe("15");
    expect(aligned[7]!.startSeconds).toBe(2.05);

    for (let i = 1; i < aligned.length; i++) {
      expect(aligned[i]!.startSeconds).toBeGreaterThanOrEqual(aligned[i - 1]!.startSeconds);
      expect(aligned[i]!.endSeconds).toBeGreaterThan(aligned[i]!.startSeconds);
    }
  });

  it("handles two transcribed words matching a single script number", () => {
    const script = "He had 25 coins.";
    const transcribed: TranscribedWord[] = [
      { word: "He", startSeconds: 0.0, endSeconds: 0.2 },
      { word: "had", startSeconds: 0.2, endSeconds: 0.4 },
      { word: "twenty", startSeconds: 0.4, endSeconds: 0.7 },
      { word: "five", startSeconds: 0.7, endSeconds: 1.0 },
      { word: "coins.", startSeconds: 1.0, endSeconds: 1.5 },
    ];

    const aligned = alignScriptToTranscription(script, transcribed, 1.5);

    expect(aligned).toHaveLength(4);
    expect(aligned.map((a) => a.word)).toEqual(["He", "had", "25", "coins."]);
    expect(aligned[2]!.word).toBe("25");
    expect(aligned[2]!.startSeconds).toBe(0.4);
    expect(aligned[2]!.endSeconds).toBe(1.0);
  });

  it("handles two script words matching a single transcribed number", () => {
    const script = "He had twenty five coins.";
    const transcribed: TranscribedWord[] = [
      { word: "He", startSeconds: 0.0, endSeconds: 0.2 },
      { word: "had", startSeconds: 0.2, endSeconds: 0.4 },
      { word: "25", startSeconds: 0.4, endSeconds: 1.0 },
      { word: "coins.", startSeconds: 1.0, endSeconds: 1.5 },
    ];

    const aligned = alignScriptToTranscription(script, transcribed, 1.5);

    expect(aligned).toHaveLength(5);
    expect(aligned.map((a) => a.word)).toEqual(["He", "had", "twenty", "five", "coins."]);
    expect(aligned[2]!.word).toBe("twenty");
    expect(aligned[2]!.startSeconds).toBe(0.4);
    expect(aligned[3]!.word).toBe("five");
    expect(aligned[3]!.endSeconds).toBe(1.0);
  });

  it("falls back to even distribution when transcription is empty", () => {
    const script = "one two three four";
    const aligned = alignScriptToTranscription(script, [], 4.0);

    expect(aligned).toHaveLength(4);
    expect(aligned[0]).toEqual({ word: "one", startSeconds: 0, endSeconds: 1 });
    expect(aligned[3]).toEqual({ word: "four", startSeconds: 3, endSeconds: 4 });
  });
});

describe("Whisper runtime discovery", () => {
  it("resolves binary path or defaults to whisper-cli", () => {
    const resolved = resolveWhisperBinaryPath();
    expect(typeof resolved).toBe("string");
    expect(resolved.length).toBeGreaterThan(0);
  });

  it("can inspect binary availability", () => {
    const available = isWhisperBinaryAvailable();
    expect(typeof available).toBe("boolean");
  });

  it("can inspect full whisper availability", () => {
    const available = isWhisperAvailable();
    expect(typeof available).toBe("boolean");
    if (available) {
      expect(resolveWhisperModelPath()).toBeDefined();
    }
  });
});
