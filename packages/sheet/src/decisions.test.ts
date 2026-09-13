import { leavesOf } from "@shortreelcuts/plan";
import { describe, expect, it } from "vitest";
import { buildDecisionGroups } from "./decisions.js";
import { makeSheetFixturePlan } from "./testing/fixtures.js";

const noCandidates = () => undefined;

describe("buildDecisionGroups", () => {
  it("covers every plan field that carries a decision — SPEC.md §18's acceptance criterion", () => {
    const plan = makeSheetFixturePlan();
    const groups = buildDecisionGroups(plan, noCandidates);

    const rowPaths = groups.flatMap((g) => g.rows.flatMap((r) => r.planPaths));
    const everyLeaf = leavesOf(plan).map((leaf) => leaf.path);

    // A row's plan path covers itself and anything nested under it — "align.words" stands for
    // every individual word timing leaf beneath it, the same way "footage.b1" would stand for a
    // whole clip decision rather than needing one row per field.
    const isCovered = (path: string) => rowPaths.some((row) => path === row || path.startsWith(`${row}.`));

    // planVersion is a document-version marker (see graph.ts's ownerOf), and a `.reason` leaf is
    // the explanation already shown as the row's own `reason` field, not a second decision.
    const decisionBearing = everyLeaf.filter((path) => path !== "planVersion" && !path.endsWith(".reason"));

    const missing = decisionBearing.filter((path) => !isCovered(path));
    expect(missing).toEqual([]);
  });

  it("every row states what was chosen and why, never leaving either blank", () => {
    const plan = makeSheetFixturePlan();
    for (const group of buildDecisionGroups(plan, noCandidates)) {
      for (const row of group.rows) {
        expect(row.chosen.length).toBeGreaterThan(0);
        expect(row.reason.length).toBeGreaterThan(0);
      }
    }
  });

  it("a row's control, when present, always targets one of the row's own plan paths", () => {
    const plan = makeSheetFixturePlan();
    for (const group of buildDecisionGroups(plan, noCandidates)) {
      for (const row of group.rows) {
        if (row.control) {
          expect(row.planPaths).toContain(row.control.planPath);
        }
      }
    }
  });

  it("the six groups match the card's own grouping, each with a short collapsed summary", () => {
    const plan = makeSheetFixturePlan();
    const groups = buildDecisionGroups(plan, noCandidates);
    expect(groups.map((g) => g.id)).toEqual(["script", "voice", "footage", "captions", "music", "format"]);
    for (const group of groups) {
      expect(group.summary.length).toBeGreaterThan(0);
      expect(group.summary.length).toBeLessThan(80); // a one-line summary, not a paragraph
    }
  });

  it("surfaces rejected candidates when the lookup has them, without inventing any when it doesn't", () => {
    const plan = makeSheetFixturePlan();
    const withCandidates = buildDecisionGroups(plan, (rowId) =>
      rowId === "voice.voiceId" ? [{ id: "warm-female", label: "x", chosen: true }, { id: "confident-male", label: "y", chosen: false }] : undefined,
    );
    const voiceRow = withCandidates.find((g) => g.id === "voice")?.rows.find((r) => r.id === "voice.voiceId");
    expect(voiceRow?.candidates).toHaveLength(2);

    const withoutCandidates = buildDecisionGroups(plan, noCandidates);
    const footageRow = withoutCandidates.find((g) => g.id === "footage")?.rows.find((r) => r.id === "footage.b1");
    expect(footageRow?.candidates).toBeUndefined();
    expect(footageRow?.control).toBeUndefined(); // no candidates to pick from means no clip-picker control
  });
});
