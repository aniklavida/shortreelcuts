/**
 * Test support for this package only — not exported from the public entry
 * point. Kept as its own small copy rather than a cross-package import
 * from `@shortreelcuts/sheet`'s equivalent fixture, the same way
 * `@shortreelcuts/render` keeps its own rather than reaching into
 * `@shortreelcuts/plan`'s private `testing/` folder.
 */
import type { Plan } from "@shortreelcuts/plan";

/** A plan with every stage already decided — as if `generate()` had already run once. */
export function makeSheetFixturePlan(overrides: Partial<Plan> = {}): Plan {
  const base: Plan = {
    planVersion: 2,
    seed: 7,
    brief: { prompt: "a video about why the sky is blue", targetSeconds: 24, tone: "calm" },
    script: {
      hook: "Ever wondered why the sky is blue?",
      beats: [
        { id: "b1", narration: "Sunlight looks white, but it's every colour at once.", onScreen: "Sunlight", search: "sunlight through clouds" },
        { id: "b2", narration: "Blue light scatters more than the rest as it hits the air.", onScreen: "Scattering", search: "blue sky closeup" },
      ],
      reason: "two beats — the setup, then the mechanism — fit a calm, short explainer",
    },
    voice: { provider: "stub", voiceId: "warm-female", rate: 1.0, reason: "matches the calm tone at a normal pace" },
    footage: {
      b1: {
        source: "stock",
        provider: "stub",
        assetId: "b1-candidate-0",
        in: 0,
        out: 4,
        credit: { creator: "a stub creator", pageUrl: "https://stub.invalid/b1-candidate-0" },
        reason: "closest of 4 candidates for \"sunlight through clouds\"",
      },
      b2: {
        source: "stock",
        provider: "stub",
        assetId: "b2-candidate-1",
        in: 0,
        out: 4,
        credit: { creator: "a stub creator", pageUrl: "https://stub.invalid/b2-candidate-1" },
        reason: "closest of 4 candidates for \"blue sky closeup\"",
      },
    },
    align: {
      provider: "stub-aligner",
      words: {
        b1: [
          { word: "Sunlight", startSeconds: 0, endSeconds: 0.32 },
          { word: "looks", startSeconds: 0.32, endSeconds: 0.64 },
        ],
        b2: [
          { word: "Blue", startSeconds: 0, endSeconds: 0.32 },
          { word: "light", startSeconds: 0.32, endSeconds: 0.64 },
        ],
      },
      reason: "4 words timed at ~0.32s each, scaled by the chosen voice's rate",
    },
    captions: { style: "bold-white-outline", position: "lower-third", wordsPerCue: 3, reason: "three words at a time stays readable on a phone screen" },
    music: { enabled: false, volume: 0, reason: "no bed selected — the voice carries the video alone" },
    format: { width: 1080, height: 1920, fps: 30, container: "mp4" },
  };

  return { ...base, ...overrides };
}
