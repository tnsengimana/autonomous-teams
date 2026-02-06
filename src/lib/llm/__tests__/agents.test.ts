import { describe, expect, test, vi } from "vitest";
import * as llmProviders from "@/lib/llm/providers";
import { generateAgentConfiguration } from "../agents";

describe("generateAgentConfiguration", () => {
  test("observer meta-prompt enforces UUID-only relevantNodeIds", async () => {
    const mockGenerateLLMObject = vi
      .spyOn(llmProviders, "generateLLMObject")
      .mockResolvedValueOnce({
        name: "Alpha Pulse",
        conversationSystemPrompt: "conversation prompt",
        observerSystemPrompt: "observer prompt",
        analysisGenerationSystemPrompt: "analysis prompt",
        adviceGenerationSystemPrompt: "advice prompt",
        knowledgeAcquisitionSystemPrompt: "knowledge acquisition prompt",
        graphConstructionSystemPrompt: "graph construction prompt",
      });

    await generateAgentConfiguration(
      "Find short-term investment opportunities",
      60_000,
    );

    expect(mockGenerateLLMObject).toHaveBeenCalledTimes(1);

    const systemPrompt = mockGenerateLLMObject.mock.calls[0][2];
    expect(systemPrompt).toContain(
      "relevantNodeIds MUST contain only UUIDs from the graph context",
    );
    expect(systemPrompt).toContain(
      'Never use node names, labels, or "Type:Name" values in relevantNodeIds',
    );

    mockGenerateLLMObject.mockRestore();
  });
});
