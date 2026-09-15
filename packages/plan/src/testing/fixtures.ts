/**
 * A realistic, fully-decided plan fixture shared by the test suite.
 *
 * Not exported from the package's public entry point — this is test
 * support only, and it describes fictional example content, not anything
 * a stage actually produced (no stage exists yet).
 */
import type { Plan } from "../schema.js";

export function makeFixturePlan(overrides: Partial<Plan> = {}): Plan {
  const base: Plan = {
    planVersion: 2,
    seed: 41207,
    brief: {
      prompt: "a 30 second video about why tea tastes different across Bangladesh",
      targetSeconds: 30,
      tone: "calm",
    },
    script: {
      hook: "Ever wondered why your cha tastes different in Sylhet than in Dhaka?",
      beats: [
        {
          id: "b1",
          narration: "It starts with the leaf, grown on the hills of Sylhet.",
          onScreen: "The leaf",
          search: "tea leaves closeup hillside",
        },
        {
          id: "b2",
          narration: "Then hands sort and dry it, the way they always have.",
          onScreen: "Hands at work",
          search: "hands sorting tea leaves",
        },
      ],
      reason: "two beats — origin then process — fit a calm 30 second hook-and-explain shape",
    },
    voice: {
      provider: "stub",
      voiceId: "warm-female",
      rate: 1.0,
      reason: "a warm, unhurried voice matches the calm tone in the brief",
    },
    footage: {
      b1: {
        source: "stock",
        provider: "stub",
        assetId: "clip-hillside-1",
        in: 0,
        out: 4.2,
        credit: { creator: "a stub creator", pageUrl: "https://stub.invalid/clip-hillside-1" },
        reason: "closest candidate match for \"tea leaves closeup hillside\"",
      },
      b2: {
        source: "stock",
        provider: "stub",
        assetId: "clip-hands-1",
        in: 1.5,
        out: 5.0,
        credit: { creator: "a stub creator", pageUrl: "https://stub.invalid/clip-hands-1" },
        reason: "closest candidate match for \"hands sorting tea leaves\"",
      },
    },
    align: {
      provider: "stub-whisper",
      words: {
        b1: [
          { word: "It", startSeconds: 0.0, endSeconds: 0.15 },
          { word: "starts", startSeconds: 0.15, endSeconds: 0.45 },
        ],
        b2: [
          { word: "Then", startSeconds: 0.0, endSeconds: 0.2 },
          { word: "hands", startSeconds: 0.2, endSeconds: 0.5 },
        ],
      },
      reason: "word-level timings from the stub aligner, one entry per spoken word",
    },
    captions: {
      style: "bold-white-outline",
      position: "lower-third",
      wordsPerCue: 3,
      reason: "three words at a time stays readable at 1080px wide on a phone screen",
    },
    music: {
      enabled: false,
      volume: 0,
      reason: "no bed selected — the brief did not ask for one and the voice carries the video alone",
    },
    format: { width: 1080, height: 1920, fps: 30, container: "mp4" },
  };

  return { ...base, ...overrides };
}

/**
 * A `planVersion` 1 document, in the shape a plan actually stored before
 * `migrate.ts`'s 1→2 step existed — untyped (`Record<string, unknown>`,
 * not `Plan`) on purpose, because `Plan` no longer describes this shape at
 * all. Only `migrate()` should ever see a document like this; every other
 * caller in this repository gets `Plan` at the current version.
 */
export function makeV1FixturePlan(): Record<string, unknown> {
  return {
    planVersion: 1,
    seed: 41207,
    brief: {
      prompt: "a 30 second video about why tea tastes different across Bangladesh",
      targetSeconds: 30,
      tone: "calm",
    },
    script: {
      hook: "Ever wondered why your cha tastes different in Sylhet than in Dhaka?",
      beats: [
        {
          id: "b1",
          narration: "It starts with the leaf, grown on the hills of Sylhet.",
          onScreen: "The leaf",
          search: "tea leaves closeup hillside",
        },
        {
          id: "b2",
          narration: "Then hands sort and dry it, the way they always have.",
          onScreen: "Hands at work",
          search: "hands sorting tea leaves",
        },
      ],
      reason: "two beats — origin then process — fit a calm 30 second hook-and-explain shape",
    },
    voice: {
      provider: "stub",
      voiceId: "warm-female",
      rate: 1.0,
      reason: "a warm, unhurried voice matches the calm tone in the brief",
    },
    footage: {
      b1: {
        provider: "stub",
        assetId: "clip-hillside-1",
        in: 0,
        out: 4.2,
        reason: "closest candidate match for \"tea leaves closeup hillside\"",
      },
      b2: {
        provider: "stub",
        assetId: "clip-hands-1",
        in: 1.5,
        out: 5.0,
        reason: "closest candidate match for \"hands sorting tea leaves\"",
      },
    },
    align: {
      provider: "stub-whisper",
      words: {
        b1: [
          { word: "It", startSeconds: 0.0, endSeconds: 0.15 },
          { word: "starts", startSeconds: 0.15, endSeconds: 0.45 },
        ],
        b2: [
          { word: "Then", startSeconds: 0.0, endSeconds: 0.2 },
          { word: "hands", startSeconds: 0.2, endSeconds: 0.5 },
        ],
      },
      reason: "word-level timings from the stub aligner, one entry per spoken word",
    },
    captions: {
      style: "bold-white-outline",
      position: "lower-third",
      wordsPerCue: 3,
      reason: "three words at a time stays readable at 1080px wide on a phone screen",
    },
    music: {
      enabled: false,
      volume: 0,
      reason: "no bed selected — the brief did not ask for one and the voice carries the video alone",
    },
    format: { width: 1080, height: 1920, fps: 30, container: "mp4" },
  };
}
