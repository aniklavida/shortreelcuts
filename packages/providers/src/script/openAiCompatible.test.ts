/**
 * Proves the request/response plumbing against a controlled local HTTP
 * server standing in for "a hosted API" — reliable and fast, unlike a
 * real model, which is what `openAiCompatible.e2e.test.ts` exercises
 * separately, against a real local runtime, with the reliability
 * questions that come with an actual (and, tonight, a very small) model.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Brief } from "@shortreelcuts/plan";
import {
  createOpenAiCompatibleScriptProvider,
  ScriptProviderParseError,
  ScriptProviderRequestError,
} from "./openAiCompatible.js";

const BRIEF: Brief = { prompt: "why the ocean is salty", targetSeconds: 20, tone: "calm" };
const SECRET_KEY = "sk-test-do-not-leak-4f9c2";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function chatCompletion(content: string): unknown {
  return { choices: [{ message: { content } }] };
}

describe("createOpenAiCompatibleScriptProvider", () => {
  let server: Server;
  let baseURL: string;
  let lastAuthHeader: string | undefined;
  let respondWith: () => { status: number; body: unknown };

  beforeEach(async () => {
    respondWith = () => ({ status: 200, body: chatCompletion('{"hook":"h","beats":["b1","b2"],"reason":"r"}') });
    server = createServer(async (req, res) => {
      lastAuthHeader = req.headers["authorization"];
      await readBody(req);
      const { status, body } = respondWith();
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("expected an AddressInfo");
    baseURL = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("sends the key as a bearer token for a byok connection, and builds a valid ScriptPlan from the model's beats", async () => {
    const provider = createOpenAiCompatibleScriptProvider({
      kind: "byok",
      baseURL,
      model: "test-model",
      apiKey: SECRET_KEY,
    });

    const plan = await provider.generate(BRIEF, 1);

    expect(lastAuthHeader).toBe(`Bearer ${SECRET_KEY}`);
    expect(plan.hook).toBe("h");
    expect(plan.reason).toBe("r");
    expect(plan.beats).toEqual([
      { id: "b1", narration: "b1", onScreen: "b1", search: "b1" },
      { id: "b2", narration: "b2", onScreen: "b2", search: "b2" },
    ]);
  });

  it("sends no Authorization header for a local connection", async () => {
    const provider = createOpenAiCompatibleScriptProvider({ kind: "local", baseURL, model: "smollm2:135m" });
    lastAuthHeader = "unset";

    await provider.generate(BRIEF, 1);

    expect(lastAuthHeader).toBeUndefined();
  });

  it("strips a markdown code fence if the model adds one despite being told not to", async () => {
    respondWith = () => ({
      status: 200,
      body: chatCompletion('```json\n{"hook":"h","beats":["b1"],"reason":"r"}\n```'),
    });
    const provider = createOpenAiCompatibleScriptProvider({ kind: "local", baseURL, model: "m" });

    const plan = await provider.generate(BRIEF, 1);

    expect(plan.hook).toBe("h");
  });

  it("throws ScriptProviderRequestError on a non-2xx response, with no credential in the message", async () => {
    respondWith = () => ({ status: 401, body: { error: "unauthorized" } });
    const provider = createOpenAiCompatibleScriptProvider({
      kind: "byok",
      baseURL,
      model: "m",
      apiKey: SECRET_KEY,
    });

    await expect(provider.generate(BRIEF, 1)).rejects.toBeInstanceOf(ScriptProviderRequestError);
    await expect(provider.generate(BRIEF, 1)).rejects.not.toThrow(new RegExp(SECRET_KEY));
  });

  it("throws ScriptProviderParseError, not a corrupted plan, when the model's content isn't the expected JSON", async () => {
    respondWith = () => ({ status: 200, body: chatCompletion("Cats purr because they are happy.") });
    const provider = createOpenAiCompatibleScriptProvider({ kind: "local", baseURL, model: "m" });

    const failure = provider.generate(BRIEF, 1);
    await expect(failure).rejects.toBeInstanceOf(ScriptProviderParseError);
    await expect(failure).rejects.toMatchObject({ rawContent: "Cats purr because they are happy." });
  });

  it("never lets the API key appear in the returned plan", async () => {
    const provider = createOpenAiCompatibleScriptProvider({
      kind: "byok",
      baseURL,
      model: "m",
      apiKey: SECRET_KEY,
    });

    const plan = await provider.generate(BRIEF, 1);

    expect(JSON.stringify(plan)).not.toContain(SECRET_KEY);
  });

  it("never writes the API key to any console method while generating", async () => {
    const provider = createOpenAiCompatibleScriptProvider({
      kind: "byok",
      baseURL,
      model: "m",
      apiKey: SECRET_KEY,
    });
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );

    try {
      await provider.generate(BRIEF, 1);
      for (const spy of spies) {
        for (const call of spy.mock.calls) {
          expect(call.join(" ")).not.toContain(SECRET_KEY);
        }
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
