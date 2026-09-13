/**
 * The test that matters most for this package: does an override re-run
 * *exactly* the stages `@shortreelcuts/plan`'s own `invalidate()` predicts
 * — proved against the real `invalidate()`, not a re-implementation of it
 * — and is the cost of that re-run reported before a single stage runs?
 *
 * `compose` here is a fast test double, not the real `@shortreelcuts/render`
 * call (see `session.e2e.test.ts` for that, gated the same way
 * `packages/render`'s own end-to-end test is). `script`, `voice`, `footage`
 * and `align` are the real stubs from this package — this file is about
 * orchestration, and using the real stubs is what makes the "script and
 * footage were never touched" assertions mean something.
 */
import { invalidate } from "@shortreelcuts/plan";
import { describe, expect, it, vi } from "vitest";
import { ProjectSession, type SessionEvents } from "./session.js";
import { makeFakeRunners } from "./testing/fakeRunners.js";

function makeRunners() {
  return { runners: makeFakeRunners() };
}

function makeSession(events?: SessionEvents) {
  const { runners } = makeRunners();
  const session = new ProjectSession({ runners, workDir: "/tmp/shortreelcuts-sheet-test", events });
  return { session, runners };
}

const brief = { prompt: "a video about why the sky is blue", targetSeconds: 24, tone: "calm" };

describe("ProjectSession.generate", () => {
  it("runs every stage once, script before voice/footage before align before compose", async () => {
    const order: string[] = [];
    const { session } = makeSession({
      onStageStart: (s) => order.push(s),
    });
    await session.generate({ brief, seed: 7 });

    expect(new Set(order)).toEqual(new Set(["script", "voice", "footage", "align", "compose"]));
    expect(order.indexOf("script")).toBeLessThan(order.indexOf("voice"));
    expect(order.indexOf("script")).toBeLessThan(order.indexOf("footage"));
    expect(order.indexOf("voice")).toBeLessThan(order.indexOf("align"));
    expect(order.indexOf("footage")).toBeLessThan(order.indexOf("compose"));
    expect(order.indexOf("align")).toBeLessThan(order.indexOf("compose"));
  });

  it("produces a valid plan and records it as the first version", async () => {
    const { session } = makeSession();
    const plan = await session.generate({ brief, seed: 7 });
    expect(plan.script.beats.length).toBeGreaterThan(0);
    expect(session.history).toHaveLength(1);
    expect(session.plan).toBe(plan);
  });
});

describe("ProjectSession.applyOverride — selective invalidation", () => {
  it("changing the voice re-runs voice, align and compose only — matching invalidate() exactly", async () => {
    const { session, runners } = makeSession();
    await session.generate({ brief, seed: 7 });
    vi.clearAllMocks();

    const result = await session.applyOverride([["voice.voiceId", "confident-male"]]);

    const expected = invalidate(["voice.voiceId"]);
    expect(result.ranStages).toEqual(expected);
    expect(result.ranStages).toEqual(["voice", "align", "compose"]);

    expect(runners.script).not.toHaveBeenCalled();
    expect(runners.footage).not.toHaveBeenCalled();
    expect(runners.voice).toHaveBeenCalledTimes(1);
    expect(runners.align).toHaveBeenCalledTimes(1);
    expect(runners.compose).toHaveBeenCalledTimes(1);

    // The user's explicit choice survives the voice stub's own re-run, which would otherwise
    // pick its own default and silently discard the override.
    expect(result.plan.voice.voiceId).toBe("confident-male");
    expect(result.plan.script.hook).toBe(session.history[0]?.script.hook); // untouched
  });

  it("swapping one clip re-runs compose only", async () => {
    const { session, runners } = makeSession();
    const initial = await session.generate({ brief, seed: 7 });
    const otherCandidate = session.candidatesFor("footage.b1")?.find((c) => !c.chosen);
    expect(otherCandidate).toBeDefined();
    vi.clearAllMocks();

    const result = await session.applyOverride([["footage.b1.assetId", otherCandidate!.id]]);

    expect(result.ranStages).toEqual(invalidate(["footage.b1.assetId"]));
    expect(result.ranStages).toEqual(["compose"]);
    expect(runners.script).not.toHaveBeenCalled();
    expect(runners.voice).not.toHaveBeenCalled();
    expect(runners.footage).not.toHaveBeenCalled();
    expect(runners.align).not.toHaveBeenCalled();
    expect(runners.compose).toHaveBeenCalledTimes(1);

    expect(result.plan.footage.b1?.assetId).toBe(otherCandidate!.id);
    expect(result.plan.script).toEqual(initial.script); // untouched
    expect(result.plan.voice).toEqual(initial.voice); // untouched
  });

  it("changing a caption colour/style re-runs compose only, per SPEC.md §17's acceptance criterion", async () => {
    const { session, runners } = makeSession();
    await session.generate({ brief, seed: 7 });
    vi.clearAllMocks();

    const result = await session.applyOverride([["captions.style", "minimal-white"]]);

    expect(result.ranStages).toEqual(["compose"]);
    expect(runners.voice).not.toHaveBeenCalled();
    expect(runners.align).not.toHaveBeenCalled();
    expect(result.plan.captions.style).toBe("minimal-white");
  });

  it("changing the footage provider re-runs footage and compose, not voice or align", async () => {
    const { session, runners } = makeSession();
    await session.generate({ brief, seed: 7 });
    vi.clearAllMocks();

    const result = await session.applyOverride([["footage.b1.provider", "a-different-provider"]]);

    expect(result.ranStages).toEqual(invalidate(["footage.b1.provider"]));
    expect(result.ranStages).toEqual(["footage", "compose"]);
    expect(runners.voice).not.toHaveBeenCalled();
    expect(runners.align).not.toHaveBeenCalled();
    expect(runners.footage).toHaveBeenCalledTimes(1);
  });

  it("editing a beat's narration text re-runs voice, align and compose — not script, per graph.ts's field rule", async () => {
    const { session, runners } = makeSession();
    await session.generate({ brief, seed: 7 });
    vi.clearAllMocks();

    const result = await session.applyOverride([["script.beats.0.narration", "A brand new line, spoken differently."]]);

    expect(result.ranStages).toEqual(invalidate(["script.beats.0.narration"]));
    expect(result.ranStages).toEqual(["voice", "align", "compose"]);
    expect(runners.script).not.toHaveBeenCalled();
    expect(result.plan.script.beats[0]?.narration).toBe("A brand new line, spoken differently.");
  });

  it("reports the cost estimate before any stage of the re-run starts", async () => {
    const log: string[] = [];
    const { runners } = makeRunners();
    const session = new ProjectSession({
      runners,
      workDir: "/tmp/shortreelcuts-sheet-test",
      events: {
        onCostEstimate: () => log.push("cost"),
        onStageStart: (s) => log.push(`start:${s}`),
      },
    });
    await session.generate({ brief, seed: 7 });
    log.length = 0; // only the override's own event order is under test here

    await session.applyOverride([["voice.voiceId", "confident-male"]]);

    expect(log[0]).toBe("cost");
    expect(log.slice(1)).toEqual(["start:voice", "start:align", "start:compose"]);
  });

  it("a change to the prompt itself re-runs everything", async () => {
    const { session, runners } = makeSession();
    await session.generate({ brief, seed: 7 });
    vi.clearAllMocks();

    const result = await session.applyOverride([["brief.prompt", "a video about volcanoes"]]);

    expect(result.ranStages).toEqual(["script", "voice", "footage", "align", "compose"]);
    expect(runners.script).toHaveBeenCalledTimes(1);
  });

  it("previewCost reports the same estimate applyOverride would, without running or recording anything", async () => {
    const { session, runners } = makeSession();
    await session.generate({ brief, seed: 7 });
    vi.clearAllMocks();

    const preview = session.previewCost([["voice.voiceId", "confident-male"]]);
    expect(preview.estimate.stages).toEqual(invalidate(["voice.voiceId"]));
    expect(runners.voice).not.toHaveBeenCalled();
    expect(session.history).toHaveLength(1); // no new version recorded by a preview
  });

  it("applyRawPlan diffs a whole hand-edited plan down to leaf edits and re-runs only what they touch", async () => {
    const { session, runners } = makeSession();
    const initial = await session.generate({ brief, seed: 7 });
    vi.clearAllMocks();

    const edited = { ...initial, captions: { ...initial.captions, position: "center" as const } };
    const result = await session.applyRawPlan(edited);

    expect(result.ranStages).toEqual(["compose"]);
    expect(result.plan.captions.position).toBe("center");
    expect(runners.voice).not.toHaveBeenCalled();
    expect(runners.compose).toHaveBeenCalledTimes(1);
  });

  it("keeps every prior version in history rather than overwriting it", async () => {
    const { session } = makeSession();
    await session.generate({ brief, seed: 7 });
    await session.applyOverride([["captions.style", "minimal-white"]]);
    await session.applyOverride([["captions.position", "center"]]);

    expect(session.history).toHaveLength(3);
    expect(session.history[0]?.captions.style).toBe("bold-white-outline");
    expect(session.history[2]?.captions.position).toBe("center");
  });
});
