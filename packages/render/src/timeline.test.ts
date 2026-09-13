import type { Plan } from "@shortreelcuts/plan";
import { describe, expect, it } from "vitest";
import { buildCuesForBeat, buildTimeline } from "./timeline.js";

function planWithBeats(): Plan {
  return {
    planVersion: 1,
    seed: 1,
    brief: { prompt: "test", targetSeconds: 10, tone: "calm" },
    script: {
      hook: "hook",
      beats: [
        { id: "b1", narration: "first beat", onScreen: "First", search: "first" },
        { id: "b2", narration: "second beat", onScreen: "Second", search: "second" },
        { id: "b3", narration: "third beat", onScreen: "Third", search: "third" },
      ],
      reason: "three beats for a timeline test",
    },
    voice: { provider: "stub", voiceId: "v1", rate: 1, reason: "test voice" },
    footage: {
      b1: { provider: "stub", assetId: "a1", in: 0, out: 4, reason: "test clip 1" },
      b2: { provider: "stub", assetId: "a2", in: 1, out: 3, reason: "test clip 2 — shorter than its narration" },
      b3: { provider: "stub", assetId: "a3", in: 0, out: 10, reason: "test clip 3 — longer than its narration" },
    },
    align: {
      provider: "stub",
      words: {
        b1: [
          { word: "first", startSeconds: 0, endSeconds: 0.5 },
          { word: "beat", startSeconds: 0.5, endSeconds: 1 },
        ],
        b2: [
          { word: "second", startSeconds: 0, endSeconds: 0.6 },
          { word: "beat", startSeconds: 0.6, endSeconds: 1.2 },
        ],
        b3: [
          { word: "third", startSeconds: 0, endSeconds: 0.4 },
          { word: "beat", startSeconds: 0.4, endSeconds: 0.9 },
        ],
      },
      reason: "test alignment",
    },
    captions: { style: "test", position: "lower-third", wordsPerCue: 1, reason: "one word per cue for the test" },
    music: { enabled: false, volume: 0, reason: "no music in this test" },
    format: { width: 1080, height: 1920, fps: 30, container: "mp4" },
  };
}

describe("buildCuesForBeat", () => {
  it("groups words into wordsPerCue-sized cues shifted by the offset", () => {
    const words = [
      { word: "a", startSeconds: 0, endSeconds: 0.2 },
      { word: "b", startSeconds: 0.2, endSeconds: 0.4 },
      { word: "c", startSeconds: 0.4, endSeconds: 0.6 },
    ];
    const cues = buildCuesForBeat(words, 2, 10);
    expect(cues).toEqual([
      { startSeconds: 10, endSeconds: 10.4, text: "a b" },
      { startSeconds: 10.4, endSeconds: 10.6, text: "c" },
    ]);
  });

  it("returns nothing for a beat with no aligned words", () => {
    expect(buildCuesForBeat([], 3, 0)).toEqual([]);
  });
});

describe("buildTimeline", () => {
  const media = {
    footage: { b1: "/media/f1.mp4", b2: "/media/f2.mp4", b3: "/media/f3.mp4" },
    narration: { b1: "/media/n1.wav", b2: "/media/n2.wav", b3: "/media/n3.wav" },
  };
  // b1: footage 4s available, narration 4s -> exact fit.
  // b2: footage 2s available (in=1,out=3), narration 5s -> held 3s.
  // b3: footage 10s available, narration 3s -> trimmed down.
  const measured = {
    narrationSeconds: { b1: 4, b2: 5, b3: 3 },
    footageSeconds: { b1: 4, b2: 3, b3: 10 },
  };

  it("keeps the first scene at offset zero and starts each next one transition-seconds before the previous one ends", () => {
    const timeline = buildTimeline(planWithBeats(), media, measured, 0.5);

    expect(timeline.scenes.map((scene) => scene.startOffsetSeconds)).toEqual([0, 3.5, 8]);
    // b1 ends at 0 + 4 = 4; b2 starts at 4 - 0.5 = 3.5, ends at 3.5 + 5 = 8.5;
    // b3 starts at 8.5 - 0.5 = 8, ends at 8 + 3 = 11.
    expect(timeline.totalDurationSeconds).toBeCloseTo(11, 5);
  });

  it("holds the last frame when footage is shorter than its scene, and trims when longer", () => {
    const timeline = buildTimeline(planWithBeats(), media, measured, 0.5);
    const [b1, b2, b3] = timeline.scenes;

    expect(b1?.holdLastFrameSeconds).toBeCloseTo(0, 5); // 4s available, 4s needed
    expect(b2?.holdLastFrameSeconds).toBeCloseTo(3, 5); // 2s available, 5s needed
    expect(b3?.holdLastFrameSeconds).toBeCloseTo(0, 5); // 10s available, only 3s needed — trimmed, not held
  });

  it("clamps a footage out-point to the source file's real length", () => {
    const timeline = buildTimeline(planWithBeats(), media, {
      narrationSeconds: { b1: 4, b2: 5, b3: 3 },
      footageSeconds: { b1: 4, b2: 3, b3: 2.5 }, // b3's source is actually only 2.5s, not the plan's out=10
    });
    const b3 = timeline.scenes[2];
    expect(b3?.sourceOutSeconds).toBeCloseTo(2.5, 5);
    expect(b3?.holdLastFrameSeconds).toBeCloseTo(0.5, 5); // needs 3s, only 2.5s available now
  });

  it("produces cues already shifted onto the global timeline", () => {
    const timeline = buildTimeline(planWithBeats(), media, measured, 0.5);
    // b2 starts at 3.5; its first word starts at 0 relative to its own narration.
    const b2Cue = timeline.cues.find((cue) => cue.text === "second");
    expect(b2Cue?.startSeconds).toBeCloseTo(3.5, 5);
  });

  it("skips the transition entirely for a single-beat plan", () => {
    const plan = planWithBeats();
    const singleBeatPlan: Plan = {
      ...plan,
      script: { ...plan.script, beats: [plan.script.beats[0]!] },
    };
    const timeline = buildTimeline(
      singleBeatPlan,
      { footage: { b1: media.footage.b1! }, narration: { b1: media.narration.b1! } },
      { narrationSeconds: { b1: 4 }, footageSeconds: { b1: 4 } },
      0.5,
    );
    expect(timeline.transitionSeconds).toBe(0);
    expect(timeline.scenes[0]?.startOffsetSeconds).toBe(0);
    expect(timeline.totalDurationSeconds).toBeCloseTo(4, 5);
  });

  it("throws when a beat's narration is too short to crossfade on both sides", () => {
    expect(() =>
      buildTimeline(planWithBeats(), media, { narrationSeconds: { b1: 0.2, b2: 5, b3: 3 }, footageSeconds: measured.footageSeconds }, 0.5),
    ).toThrow(/too short/);
  });

  it("throws when a beat has no footage decision", () => {
    const plan = planWithBeats();
    const { b1: _b1, ...rest } = plan.footage;
    expect(() => buildTimeline({ ...plan, footage: rest }, media, measured)).toThrow(/no footage decision/);
  });
});
