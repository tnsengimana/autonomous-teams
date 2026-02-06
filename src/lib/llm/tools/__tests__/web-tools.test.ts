import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { ToolContext } from "../index";
import { extractTool } from "../web-tools";

const context: ToolContext = {
  agentId: "test-agent-id",
};

describe("webExtract", () => {
  beforeEach(() => {
    process.env.TAVILY_API_KEY = "test-tavily-key";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.TAVILY_API_KEY;
  });

  test("returns extracted content on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            url: "https://example.com/article",
            raw_content: "Extracted article content",
          },
        ],
      }),
    } as unknown as Response);

    const result = await extractTool.handler(
      { url: "https://example.com/article" },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      url: "https://example.com/article",
      content: "Extracted article content",
      extractionStatus: "ok",
    });
  });

  test("returns recoverable no_content payload when extraction is empty", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [],
      }),
    } as unknown as Response);

    const result = await extractTool.handler(
      { url: "https://example.com/no-content" },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      url: "https://example.com/no-content",
      content: null,
      extractionStatus: "no_content",
      recoverable: true,
      error: {
        code: "EXTRACTION_EMPTY",
        message: "No content extracted from URL",
      },
    });
  });

  test("returns recoverable failed payload on timeout errors", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("UND_ERR_BODY_TIMEOUT"),
    );

    const result = await extractTool.handler(
      { url: "https://example.com/timeout" },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      url: "https://example.com/timeout",
      content: null,
      extractionStatus: "failed",
      recoverable: true,
      error: {
        code: "EXTRACTION_TIMEOUT",
        message: "UND_ERR_BODY_TIMEOUT",
      },
    });
  });
});
