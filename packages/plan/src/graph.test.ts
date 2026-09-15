import { describe, expect, it } from "vitest";
import { makeFixturePlan } from "./testing/fixtures.js";
import {
  downstreamOf,
  invalidate,
  invalidateScoped,
  ownerOf,
  STAGES,
  upstreamOf,
  type Stage,
} from "./graph.js";

describe("the pipeline shape", () => {
  it("has exactly the six stages, in pipeline order", () => {
    expect(STAGES).toEqual(["script", "voice", "footage", "align", "frames", "compose"]);
  });

  it("downstreamOf matches script -> {voice, footage} -> align/footage -> frames -> compose", () => {
    expect(downstreamOf("script")).toEqual(["script", "voice", "footage", "align", "frames", "compose"]);
    expect(downstreamOf("voice")).toEqual(["voice", "align", "frames", "compose"]);
    expect(downstreamOf("footage")).toEqual(["footage", "frames", "compose"]);
    expect(downstreamOf("align")).toEqual(["align", "frames", "compose"]);
    expect(downstreamOf("frames")).toEqual(["frames", "compose"]);
    expect(downstreamOf("compose")).toEqual(["compose"]);
  });

  it("upstreamOf is the mirror of downstreamOf", () => {
    expect(upstreamOf("script")).toEqual(["script"]);
    expect(upstreamOf("voice")).toEqual(["script", "voice"]);
    expect(upstreamOf("footage")).toEqual(["script", "footage"]);
    expect(upstreamOf("align")).toEqual(["script", "voice", "align"]);
    expect(upstreamOf("frames")).toEqual(["script", "voice", "footage", "align", "frames"]);
    expect(upstreamOf("compose")).toEqual(["script", "voice", "footage", "align", "frames", "compose"]);
  });

  it("compose is downstream of every other stage, and script is upstream of every other stage", () => {
    for (const stage of STAGES) {
      if (stage !== "compose") expect(downstreamOf(stage)).toContain("compose");
      if (stage !== "script") expect(upstreamOf(stage)).toContain("script");
    }
  });
});

describe("ownerOf — one assertion per rule", () => {
  const cases: ReadonlyArray<[string, Stage | null]> = [
    // never-invalidating fields
    ["planVersion", null],
    ["script.reason", null],
    ["voice.reason", null],
    ["footage.b1.reason", null],
    ["align.reason", null],
    ["captions.reason", null],
    ["music.reason", null],

    // whole-document, conservative
    ["seed", "script"],
    ["brief.prompt", "script"],
    ["brief.targetSeconds", "script"],
    ["brief.tone", "script"],
    ["brief", "script"],

    // script — field-level exceptions
    ["script.hook", "voice"],
    ["script.beats.0.narration", "voice"],
    ["script.beats.1.narration", "voice"],
    ["script.beats.0.onScreen", "compose"],
    ["script.beats.0.search", "footage"],
    ["script.beats.0.id", "script"],
    // script — unmatched subfields fall back to the script namespace
    ["script.beats", "script"],
    ["script.beats.0", "script"],
    ["script", "script"],

    // voice — whole namespace
    ["voice.provider", "voice"],
    ["voice.voiceId", "voice"],
    ["voice.rate", "voice"],
    ["voice", "voice"],

    // footage — field-level exceptions for the three-source union (docs/SPEC.md §11)
    ["footage.b1.source", "footage"],
    ["footage.b1.assetId", "frames"],
    ["footage.b1.in", "frames"],
    ["footage.b1.out", "frames"],
    ["footage.b1.provider", "footage"],
    ["footage.b1.credit.creator", null],
    ["footage.b1.credit.pageUrl", null],
    ["footage.b1.prompt", "footage"],
    ["footage.b1.model", "footage"],
    ["footage.b1.seconds", "footage"],
    ["footage.b1.output.mediaKey", null],
    ["footage.b1.output.jobId", null],
    ["footage.b1.scene.kind", "frames"],
    ["footage.b1.scene.params.headline", "frames"],
    ["footage.b1.scene.html", "frames"],
    ["footage.b1.captionsInScene", "frames"],
    // footage — unmatched subfields fall back to the footage namespace
    ["footage.b1", "footage"],
    ["footage", "footage"],

    // render metadata — recorded, never a decision
    ["render.chromium", null],
    ["render.runtime", null],
    ["render.ffmpeg", null],
    ["render", null],

    // align — whole namespace, any depth
    ["align.provider", "align"],
    ["align.words.b1.0.startSeconds", "align"],
    ["align.words.b1.0.word", "align"],
    ["align", "align"],

    // compose-only namespaces
    ["captions.style", "compose"],
    ["captions.position", "compose"],
    ["captions.wordsPerCue", "compose"],
    ["captions", "compose"],
    ["music.enabled", "compose"],
    ["music.volume", "compose"],
    ["music", "compose"],
    ["format.width", "compose"],
    ["format.fps", "compose"],
    ["format", "compose"],

    // unrecognised field: conservative fallback
    ["somethingNobodyThoughtOf", "script"],
  ];

  for (const [path, expected] of cases) {
    it(`${path} -> ${expected ?? "null (no re-run)"}`, () => {
      expect(ownerOf(path)).toBe(expected);
    });
  }
});

describe("invalidate — the invalidation table, row by row (docs/SPEC.md §6, post-frames)", () => {
  it("caption colour, size or position -> compose", () => {
    expect(invalidate(["captions.style"])).toEqual(["compose"]);
    expect(invalidate(["captions.wordsPerCue"])).toEqual(["compose"]);
    expect(invalidate(["captions.position"])).toEqual(["compose"]);
  });

  it("swap one clip -> frames, compose", () => {
    expect(invalidate(["footage.b2.assetId"])).toEqual(["frames", "compose"]);
  });

  it("crop or trim a clip -> frames, compose", () => {
    expect(invalidate(["footage.b1.in"])).toEqual(["frames", "compose"]);
    expect(invalidate(["footage.b1.out"])).toEqual(["frames", "compose"]);
  });

  it("edit a motion scene's template params or hand-edited code -> frames, compose", () => {
    expect(invalidate(["footage.b1.scene.params.headline"])).toEqual(["frames", "compose"]);
    expect(invalidate(["footage.b1.scene.html"])).toEqual(["frames", "compose"]);
  });

  it("search term for one beat -> footage, frames, compose", () => {
    expect(invalidate(["script.beats.1.search"])).toEqual(["footage", "frames", "compose"]);
  });

  it("a generated beat's prompt, model or seconds -> footage, frames, compose", () => {
    expect(invalidate(["footage.b1.prompt"])).toEqual(["footage", "frames", "compose"]);
    expect(invalidate(["footage.b1.model"])).toEqual(["footage", "frames", "compose"]);
    expect(invalidate(["footage.b1.seconds"])).toEqual(["footage", "frames", "compose"]);
  });

  it("voice, or speaking rate -> voice, align, frames, compose", () => {
    expect(invalidate(["voice.rate"])).toEqual(["voice", "align", "frames", "compose"]);
    expect(invalidate(["voice.voiceId"])).toEqual(["voice", "align", "frames", "compose"]);
    expect(invalidate(["voice.provider"])).toEqual(["voice", "align", "frames", "compose"]);
  });

  it("any script line -> voice, align, frames, compose", () => {
    expect(invalidate(["script.beats.0.narration"])).toEqual(["voice", "align", "frames", "compose"]);
    expect(invalidate(["script.hook"])).toEqual(["voice", "align", "frames", "compose"]);
  });

  it("a script line whose search term also moved -> voice, footage, align, frames, compose", () => {
    expect(
      invalidate(["script.beats.0.narration", "script.beats.0.search"]),
    ).toEqual(["voice", "footage", "align", "frames", "compose"]);
  });

  it("the prompt itself -> everything", () => {
    expect(invalidate(["brief.prompt"])).toEqual(STAGES);
  });

  it("the seed -> everything", () => {
    expect(invalidate(["seed"])).toEqual(STAGES);
  });

  it("render metadata and credit/output never re-run anything", () => {
    expect(invalidate(["render.chromium", "footage.b1.credit.creator", "footage.b1.output.jobId"])).toEqual([]);
  });
});

describe("invalidate — properties beyond the table", () => {
  it("no stage ever re-runs because an unrelated stage changed", () => {
    expect(invalidate(["captions.style"])).not.toEqual(
      expect.arrayContaining(["script", "voice", "footage", "align"]),
    );
    expect(invalidate(["footage.b1.assetId"])).not.toContain("footage");
    expect(invalidate(["footage.b1.assetId"])).not.toContain("voice");
    expect(invalidate(["footage.b1.assetId"])).not.toContain("script");
  });

  it("an empty change list re-runs nothing", () => {
    expect(invalidate([])).toEqual([]);
  });

  it("only reason edits re-run nothing", () => {
    expect(invalidate(["voice.reason", "footage.b1.reason", "script.reason"])).toEqual([]);
  });

  it("editing planVersion alone re-runs nothing (that is migrate's job, not invalidate's)", () => {
    expect(invalidate(["planVersion"])).toEqual([]);
  });

  it("stages are always returned in pipeline order regardless of input order", () => {
    expect(invalidate(["captions.style", "voice.rate", "script.beats.0.search"])).toEqual([
      "voice",
      "footage",
      "align",
      "frames",
      "compose",
    ]);
  });

  it("duplicate paths do not duplicate stages", () => {
    expect(invalidate(["voice.rate", "voice.rate", "voice.voiceId"])).toEqual([
      "voice",
      "align",
      "frames",
      "compose",
    ]);
  });

  it("an unrecognised field conservatively invalidates the whole pipeline", () => {
    expect(invalidate(["aFieldNoRuleKnowsAbout"])).toEqual(STAGES);
  });
});

describe("invalidateScoped — per-beat invalidation (docs/SPEC.md §6)", () => {
  function plan() {
    return makeFixturePlan();
  }

  function motionPlan() {
    const base = makeFixturePlan();
    return {
      ...base,
      footage: {
        ...base.footage,
        b1: {
          source: "motion" as const,
          runtime: "srcuts-motion@1" as const,
          scene: { kind: "template" as const, template: "kinetic-headline", params: { headline: "hi" } },
          captionsInScene: true,
          model: "a connected model",
          reason: "a motion scene for the test",
        },
      },
    };
  }

  it("changing one beat's clip invalidates frames for that beat only", () => {
    const result = invalidateScoped(["footage.b1.assetId"], plan());
    const frames = result.find((r) => r.stage === "frames");
    expect(frames?.beats).toEqual(new Set(["b1"]));
    const compose = result.find((r) => r.stage === "compose");
    expect(compose?.beats).toBe("all");
  });

  it("changing one motion beat's template params invalidates frames for that beat only", () => {
    const result = invalidateScoped(["footage.b1.scene.params.headline"], motionPlan());
    expect(result).toEqual([
      { stage: "frames", beats: new Set(["b1"]) },
      { stage: "compose", beats: "all" },
    ]);
  });

  it("changing the voice invalidates frames for motion beats and not for stock beats", () => {
    const withMotion = motionPlan(); // b1 motion, b2 stock
    const result = invalidateScoped(["voice.rate"], withMotion);
    const frames = result.find((r) => r.stage === "frames");
    expect(frames?.beats).toEqual(new Set(["b1"]));
  });

  it("changing the voice when no beat is motion still narrows frames to nothing (an empty scoped set)", () => {
    const result = invalidateScoped(["voice.rate"], plan()); // both beats are stock
    const frames = result.find((r) => r.stage === "frames");
    expect(frames?.beats).toEqual(new Set());
  });

  it("changing align (word timings) narrows frames to motion beats the same way voice does", () => {
    const result = invalidateScoped(["align.provider"], motionPlan());
    const frames = result.find((r) => r.stage === "frames");
    expect(frames?.beats).toEqual(new Set(["b1"]));
  });

  it("a caption-only change never touches footage or frames", () => {
    const result = invalidateScoped(["captions.style"], plan());
    expect(result).toEqual([{ stage: "compose", beats: "all" }]);
  });

  it("the prompt invalidates every beat of footage and frames, not a scoped subset", () => {
    const result = invalidateScoped(["brief.prompt"], plan());
    const footage = result.find((r) => r.stage === "footage");
    const frames = result.find((r) => r.stage === "frames");
    expect(footage?.beats).toBe("all");
    expect(frames?.beats).toBe("all");
  });

  it("two edits to two different beats each scope to their own beat, merged", () => {
    const result = invalidateScoped(["footage.b1.assetId", "footage.b2.assetId"], plan());
    const frames = result.find((r) => r.stage === "frames");
    expect(frames?.beats).toEqual(new Set(["b1", "b2"]));
  });

  it("stages are still returned in pipeline order", () => {
    // "voice.rate" is voice-owned (voice, align, frames, compose); "footage.b1.assetId" is
    // frames-owned (frames, compose) — neither touches the "footage" stage itself.
    const result = invalidateScoped(["voice.rate", "footage.b1.assetId"], motionPlan());
    expect(result.map((r) => r.stage)).toEqual(["voice", "align", "frames", "compose"]);
  });

  it("an empty change list re-runs nothing", () => {
    expect(invalidateScoped([], plan())).toEqual([]);
  });
});
