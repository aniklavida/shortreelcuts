import { describe, expect, it } from "vitest";
import { downstreamOf, invalidate, ownerOf, STAGES, upstreamOf, type Stage } from "./graph.js";

describe("the pipeline shape", () => {
  it("has exactly the five stages, in pipeline order", () => {
    expect(STAGES).toEqual(["script", "voice", "footage", "align", "compose"]);
  });

  it("downstreamOf matches script -> {voice, footage} -> {align, compose}", () => {
    expect(downstreamOf("script")).toEqual(["script", "voice", "footage", "align", "compose"]);
    expect(downstreamOf("voice")).toEqual(["voice", "align", "compose"]);
    expect(downstreamOf("footage")).toEqual(["footage", "compose"]);
    expect(downstreamOf("align")).toEqual(["align", "compose"]);
    expect(downstreamOf("compose")).toEqual(["compose"]);
  });

  it("upstreamOf is the mirror of downstreamOf", () => {
    expect(upstreamOf("script")).toEqual(["script"]);
    expect(upstreamOf("voice")).toEqual(["script", "voice"]);
    expect(upstreamOf("footage")).toEqual(["script", "footage"]);
    expect(upstreamOf("align")).toEqual(["script", "voice", "align"]);
    expect(upstreamOf("compose")).toEqual(["script", "voice", "footage", "align", "compose"]);
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

    // footage — field-level exceptions
    ["footage.b1.assetId", "compose"],
    ["footage.b1.in", "compose"],
    ["footage.b1.out", "compose"],
    ["footage.b1.provider", "footage"],
    // footage — unmatched subfields fall back to the footage namespace
    ["footage.b1", "footage"],
    ["footage", "footage"],

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

describe("invalidate — the invalidation table, row by row", () => {
  it("caption colour, size or position -> compose", () => {
    expect(invalidate(["captions.style"])).toEqual(["compose"]);
    expect(invalidate(["captions.wordsPerCue"])).toEqual(["compose"]);
    expect(invalidate(["captions.position"])).toEqual(["compose"]);
  });

  it("swap one clip -> compose", () => {
    expect(invalidate(["footage.b2.assetId"])).toEqual(["compose"]);
  });

  it("crop or trim a clip -> compose", () => {
    expect(invalidate(["footage.b1.in"])).toEqual(["compose"]);
    expect(invalidate(["footage.b1.out"])).toEqual(["compose"]);
  });

  it("search term for one beat -> footage, compose", () => {
    expect(invalidate(["script.beats.1.search"])).toEqual(["footage", "compose"]);
  });

  it("voice, or speaking rate -> voice, align, compose", () => {
    expect(invalidate(["voice.rate"])).toEqual(["voice", "align", "compose"]);
    expect(invalidate(["voice.voiceId"])).toEqual(["voice", "align", "compose"]);
    expect(invalidate(["voice.provider"])).toEqual(["voice", "align", "compose"]);
  });

  it("any script line -> voice, align, compose", () => {
    expect(invalidate(["script.beats.0.narration"])).toEqual(["voice", "align", "compose"]);
    expect(invalidate(["script.hook"])).toEqual(["voice", "align", "compose"]);
  });

  it("a script line whose search term also moved -> voice, footage, align, compose", () => {
    expect(
      invalidate(["script.beats.0.narration", "script.beats.0.search"]),
    ).toEqual(["voice", "footage", "align", "compose"]);
  });

  it("the prompt itself -> everything", () => {
    expect(invalidate(["brief.prompt"])).toEqual(STAGES);
  });

  it("the seed -> everything", () => {
    expect(invalidate(["seed"])).toEqual(STAGES);
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
      "compose",
    ]);
  });

  it("duplicate paths do not duplicate stages", () => {
    expect(invalidate(["voice.rate", "voice.rate", "voice.voiceId"])).toEqual([
      "voice",
      "align",
      "compose",
    ]);
  });

  it("an unrecognised field conservatively invalidates the whole pipeline", () => {
    expect(invalidate(["aFieldNoRuleKnowsAbout"])).toEqual(STAGES);
  });
});
