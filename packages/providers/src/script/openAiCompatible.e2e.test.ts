/**
 * Runs the local-model path against a real, already-installed local
 * runtime — no mock server, no download. `docs/SPEC.md` §5.1 promises a
 * local model is a first-class connection, not a later adapter; this is
 * that promise checked against an actual local model rather than only a
 * fake HTTP server standing in for one.
 *
 * Opt in with `SHORTREELCUTS_LOCAL_MODEL_E2E=1`. Skipped otherwise — this
 * needs a local OpenAI-compatible runtime (e.g. Ollama) already running
 * with a model already pulled, which most machines running `npm test`
 * will not have. `SHORTREELCUTS_LOCAL_MODEL_BASE_URL` / `_NAME` point at
 * a different runtime or model than the defaults below.
 *
 * What this does and does not assert: it asserts the request reaches a
 * real local model and gets a real completion back with no credential
 * involved anywhere. It does not assert the completion is good JSON —
 * a small local model (this suite was written against a 135M-parameter
 * one, because that is what was already on the machine and nothing may
 * be downloaded to test this) frequently is not reliable enough to
 * produce the exact shape asked for. `ScriptProviderParseError` is
 * therefore an accepted, real outcome here, not a failure: it is the
 * provider correctly refusing to turn unparseable text into a plan
 * field, which is the behaviour SPEC.md §7 rule 1 requires either way.
 */
import { describe, expect, it } from "vitest";
import type { Brief } from "@shortreelcuts/plan";
import { createOpenAiCompatibleScriptProvider, ScriptProviderParseError } from "./openAiCompatible.js";

const RUN_E2E = process.env["SHORTREELCUTS_LOCAL_MODEL_E2E"] === "1";
const BASE_URL = process.env["SHORTREELCUTS_LOCAL_MODEL_BASE_URL"] ?? "http://127.0.0.1:11434/v1";
const MODEL = process.env["SHORTREELCUTS_LOCAL_MODEL_NAME"] ?? "smollm2:135m";

describe.skipIf(!RUN_E2E)("createOpenAiCompatibleScriptProvider against a real local runtime", () => {
  it("reaches the local model with no credential and returns either a valid plan or a clear parse failure", async () => {
    const provider = createOpenAiCompatibleScriptProvider({ kind: "local", baseURL: BASE_URL, model: MODEL });
    const brief: Brief = { prompt: "why cats purr", targetSeconds: 20, tone: "calm" };

    try {
      const plan = await provider.generate(brief, 1);
      expect(plan.hook.length).toBeGreaterThan(0);
      expect(plan.beats.length).toBeGreaterThan(0);
      expect(plan.reason.length).toBeGreaterThan(0);
    } catch (err) {
      expect(err).toBeInstanceOf(ScriptProviderParseError);
    }
  }, 60_000);
});
