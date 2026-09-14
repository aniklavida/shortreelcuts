import { describe, expect, it } from "vitest";
import { NoModelConnectionError, resolveModelConnection } from "./connection.js";

describe("resolveModelConnection", () => {
  it("resolves a byok connection when an API key is present", () => {
    const connection = resolveModelConnection({
      SHORTREELCUTS_MODEL_BASE_URL: "https://api.example.com/v1",
      SHORTREELCUTS_MODEL_NAME: "gpt-test",
      SHORTREELCUTS_MODEL_API_KEY: "sk-abc",
    });
    expect(connection).toEqual({
      kind: "byok",
      baseURL: "https://api.example.com/v1",
      model: "gpt-test",
      apiKey: "sk-abc",
    });
  });

  it("resolves a local connection when no API key is set", () => {
    const connection = resolveModelConnection({
      SHORTREELCUTS_MODEL_BASE_URL: "http://localhost:11434/v1",
      SHORTREELCUTS_MODEL_NAME: "smollm2:135m",
    });
    expect(connection).toEqual({
      kind: "local",
      baseURL: "http://localhost:11434/v1",
      model: "smollm2:135m",
    });
  });

  it("throws NoModelConnectionError when nothing is configured", () => {
    expect(() => resolveModelConnection({})).toThrow(NoModelConnectionError);
  });

  it("throws NoModelConnectionError when a base URL is set but no model name is", () => {
    expect(() =>
      resolveModelConnection({ SHORTREELCUTS_MODEL_BASE_URL: "http://localhost:11434/v1" }),
    ).toThrow(NoModelConnectionError);
  });

  it("never reads process.env itself — only the object it's given", () => {
    const original = process.env["SHORTREELCUTS_MODEL_BASE_URL"];
    process.env["SHORTREELCUTS_MODEL_BASE_URL"] = "http://should-not-be-read";
    try {
      expect(() => resolveModelConnection({})).toThrow(NoModelConnectionError);
    } finally {
      if (original === undefined) delete process.env["SHORTREELCUTS_MODEL_BASE_URL"];
      else process.env["SHORTREELCUTS_MODEL_BASE_URL"] = original;
    }
  });
});
