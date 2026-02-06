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
    expect(systemPrompt).toContain("based_on");
    expect(systemPrompt).toContain(
      "Never overload an existing type with semantically different data just to avoid creating a type",
    );
    expect(systemPrompt).toContain(
      'For quantitative fields, use machine-typed numbers and separate unit/currency fields',
    );
    expect(systemPrompt).toContain(
      'Keep formatted human strings (e.g., "$171.88", "206.31M", "$10.32B vs $8.03B") in optional raw_text only',
    );

    mockGenerateLLMObject.mockRestore();
  });
});
