/**
 * Test script to examine how AI SDK handles interleaved text between tool calls
 * and distinguish reasoning/thought from output text.
 *
 * Run with: npx tsx scripts/test-interleaved-text.ts
 *
 * Target format:
 * - request: { text: "user message" }
 * - response: [
 *     { llmThought: "internal reasoning..." },
 *     { llmOutput: "text shown to user..." },
 *     { toolCalls: [...] },
 *     { toolResults: [...] },
 *     { llmOutput: "final response..." }
 *   ]
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText, stepCountIs } from "ai";
import { z } from "zod";

// ============================================================================
// Configuration
// ============================================================================

const LMSTUDIO_BASE_URL =
  process.env.LMSTUDIO_BASE_URL || "http://localhost:1234/v1";
const MODEL =
  process.env.LMSTUDIO_MODEL || "mistralai/ministral-3-14b-reasoning";

// ============================================================================
// Test Tools
// ============================================================================

const tools = {
  weather: {
    description: "Get the current weather for a location",
    inputSchema: z.object({
      location: z
        .string()
        .describe("The city and state, e.g. San Francisco, CA"),
    }),
    execute: async ({ location }: { location: string }) => {
      console.log(`\n[Tool Execute] weather called with location: ${location}`);
      return {
        location,
        temperature: Math.floor(Math.random() * 30) + 50,
        unit: "fahrenheit",
        conditions: ["sunny", "cloudy", "rainy"][Math.floor(Math.random() * 3)],
      };
    },
  },
  calculator: {
    description: "Perform a calculation",
    inputSchema: z.object({
      expression: z
        .string()
        .describe("The mathematical expression to evaluate"),
    }),
    execute: async ({ expression }: { expression: string }) => {
      console.log(`\n[Tool Execute] calculator called with: ${expression}`);
      try {
        // Simple eval for testing (DO NOT use in production)
        const result = eval(expression);
        return { expression, result };
      } catch {
        return { expression, error: "Invalid expression" };
      }
    },
  },
  search: {
    description: "Search the web for information",
    inputSchema: z.object({
      query: z.string().describe("The search query"),
    }),
    execute: async ({ query }: { query: string }) => {
      console.log(`\n[Tool Execute] search called with query: ${query}`);
      return {
        query,
        results: [
          { title: "Result 1", snippet: `Information about ${query}` },
          { title: "Result 2", snippet: `More details on ${query}` },
        ],
      };
    },
  },
};

// ============================================================================
// Main Test
// ============================================================================

async function main() {
  console.log("Interleaved Text Test - Event-Based Format");
  console.log("===========================================");
  console.log(`Using LM Studio at: ${LMSTUDIO_BASE_URL}`);
  console.log(`Model: ${MODEL}`);

  const lmstudio = createOpenAICompatible({
    name: "lmstudio",
    baseURL: LMSTUDIO_BASE_URL,
    supportsStructuredOutputs: true,
  });

  // Simple test case - use multiple tools to see step-by-step behavior
  const userMessage = "Check the weather in New York and also calculate 25 * 4";
  const messages = [{ role: "user" as const, content: userMessage }];

  console.log("\n--- Request ---");
  console.log("User message:", userMessage);

  // Track when onStepFinish fires
  const stepFinishTimes: {
    stepIndex: number;
    timestamp: number;
    hasText: boolean;
    toolCallCount: number;
  }[] = [];
  const startTime = Date.now();

  const result = streamText({
    model: lmstudio(MODEL),
    messages,
    system:
      "You are a helpful assistant. Use the available tools to answer questions.",
    tools,
    toolChoice: "auto",
    stopWhen: stepCountIs(5),
    onStepFinish: async (event) => {
      const elapsed = Date.now() - startTime;
      const stepData = {
        stepIndex: stepFinishTimes.length,
        timestamp: elapsed,
        hasText: !!(event.text && event.text.trim()),
        toolCallCount: event.toolCalls?.length || 0,
      };
      stepFinishTimes.push(stepData);

      console.log(
        `\n>>> [onStepFinish] Step ${stepData.stepIndex + 1} at ${elapsed}ms`,
      );
      console.log(
        `    Text: ${event.text?.substring(0, 100) || "(none)"}${event.text && event.text.length > 100 ? "..." : ""}`,
      );
      console.log(`    Tool calls: ${event.toolCalls?.length || 0}`);
      if (event.toolCalls) {
        for (const tc of event.toolCalls) {
          const input = (tc as unknown as { input: Record<string, unknown> })
            .input;
          console.log(`      - ${tc.toolName}: ${JSON.stringify(input)}`);
        }
      }
      console.log(`    Tool results: ${event.toolResults?.length || 0}`);
      if (event.toolResults) {
        for (const tr of event.toolResults) {
          const output = (tr as unknown as { output: unknown }).output;
          console.log(
            `      - ${tr.toolName}: ${JSON.stringify(output)?.substring(0, 80)}`,
          );
        }
      }

      // Check for reasoning
      const eventAny = event as Record<string, unknown>;
      if (
        eventAny.reasoning &&
        Array.isArray(eventAny.reasoning) &&
        eventAny.reasoning.length > 0
      ) {
        console.log(`    Reasoning: YES (${eventAny.reasoning.length} parts)`);
      }
    },
  });

  // Collect streaming text
  let fullText = "";
  console.log("\n--- Streaming Text ---");
  for await (const chunk of result.textStream) {
    process.stdout.write(chunk);
    fullText += chunk;
  }
  console.log("\n--- End Stream ---\n");
  console.log("==========fullText===========");
  console.log(fullText);
  console.log("==========fullText===========");

  // Get the full response with steps
  const response = await result;
  const steps = await response.steps;

  // Check top-level response for reasoning
  console.log("\n--- Top-level response properties ---");
  const respAny = response as unknown as Record<string, unknown>;
  console.log(
    "Top-level keys:",
    Object.keys(respAny).filter((k) => !k.startsWith("_")),
  );
  if ("reasoning" in respAny) {
    console.log(
      `Top-level reasoning: ${JSON.stringify(respAny.reasoning)?.substring(0, 300)}`,
    );
  }
  if ("reasoningDetails" in respAny) {
    console.log(
      `Top-level reasoningDetails: ${JSON.stringify(respAny.reasoningDetails)?.substring(0, 300)}`,
    );
  }

  console.log("\n" + "=".repeat(80));
  console.log("RAW STEP DATA FROM AI SDK - EXPLORING ALL FIELDS");
  console.log("=".repeat(80));

  if (steps) {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i] as Record<string, unknown>;
      console.log(`\n--- Step ${i + 1} ---`);
      console.log("All keys on step object:", Object.keys(step));

      // Explore the content field - this is where message parts live
      if ("content" in step && Array.isArray(step.content)) {
        console.log("\nContent parts:");
        for (const part of step.content as Array<Record<string, unknown>>) {
          console.log(`  Part type: ${part.type}`);
          console.log(`  Part keys: ${Object.keys(part)}`);
          if (part.type === "reasoning") {
            console.log(
              `  Reasoning text: "${String(part.text || part.reasoning).substring(0, 150)}..."`,
            );
          } else if (part.type === "text") {
            console.log(`  Text: "${String(part.text).substring(0, 150)}..."`);
          } else if (part.type === "tool-call") {
            console.log(`  Tool call: ${part.toolName}`);
          } else if (part.type === "tool-result") {
            console.log(`  Tool result: ${part.toolName}`);
          }
        }
      }

      // Check for direct reasoning field
      if ("reasoning" in step) {
        console.log(
          `\nDirect reasoning field (type: ${typeof step.reasoning}): ${JSON.stringify(step.reasoning)?.substring(0, 300)}`,
        );
      }

      // Check response object for reasoning
      if ("response" in step && step.response) {
        const resp = step.response as Record<string, unknown>;
        console.log("Response object keys:", Object.keys(resp));
        if ("reasoning" in resp) {
          console.log(
            `Response.reasoning: ${JSON.stringify(resp.reasoning)?.substring(0, 300)}`,
          );
        }
      }

      // Standard fields
      console.log(
        `\ntext: "${step.text ? String(step.text).substring(0, 200) : "(empty)"}${step.text && String(step.text).length > 200 ? "..." : ""}"`,
      );

      const toolCalls = step.toolCalls as
        | Array<{ toolName: string }>
        | undefined;
      console.log(`toolCalls: ${toolCalls?.length || 0}`);
      if (toolCalls) {
        for (const tc of toolCalls) {
          const input = (tc as unknown as { input: Record<string, unknown> })
            .input;
          console.log(`  - ${tc.toolName}: ${JSON.stringify(input)}`);
        }
      }

      const toolResults = step.toolResults as
        | Array<{ toolName: string }>
        | undefined;
      console.log(`toolResults: ${toolResults?.length || 0}`);
      if (toolResults) {
        for (const tr of toolResults) {
          const output = (tr as unknown as { output: unknown }).output;
          console.log(
            `  - ${tr.toolName}: ${JSON.stringify(output)?.substring(0, 100)}`,
          );
        }
      }
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("TARGET FORMAT");
  console.log("=".repeat(80));

  // Build the new event-based format
  // For now, we'll use llmOutput for all text since AI SDK doesn't separate reasoning
  // In the future, if using reasoning models, we can check for 'reasoning' field

  type ResponseEvent =
    | { llmThought: string }
    | { llmOutput: string }
    | { toolCalls: Array<{ toolName: string; args: Record<string, unknown> }> }
    | { toolResults: Array<{ toolName: string; result: unknown }> };

  const events: ResponseEvent[] = [];

  if (steps) {
    for (const step of steps) {
      const stepAny = step as Record<string, unknown>;

      // Method 1: Check content array for reasoning parts (most accurate)
      if (stepAny.content && Array.isArray(stepAny.content)) {
        for (const part of stepAny.content as Array<Record<string, unknown>>) {
          if (part.type === "reasoning" && (part.text || part.reasoning)) {
            const reasoningText = String(part.text || part.reasoning);
            if (reasoningText.trim()) {
              events.push({ llmThought: reasoningText });
            }
          }
        }
      }

      // Method 2: Check direct reasoning field (fallback)
      if (
        stepAny.reasoning &&
        typeof stepAny.reasoning === "string" &&
        stepAny.reasoning.trim()
      ) {
        // Only add if not already added from content
        const alreadyAdded = events.some(
          (e) => "llmThought" in e && e.llmThought === stepAny.reasoning,
        );
        if (!alreadyAdded) {
          events.push({ llmThought: stepAny.reasoning as string });
        }
      }

      // Text output (what the user sees)
      if (step.text && step.text.trim()) {
        events.push({ llmOutput: step.text });
      }

      // Tool calls
      if (step.toolCalls && step.toolCalls.length > 0) {
        events.push({
          toolCalls: step.toolCalls.map((tc) => ({
            toolName: tc.toolName,
            args: (tc as unknown as { input: Record<string, unknown> }).input,
          })),
        });
      }

      // Tool results
      if (step.toolResults && step.toolResults.length > 0) {
        events.push({
          toolResults: step.toolResults.map((tr) => ({
            toolName: tr.toolName,
            result: (tr as unknown as { output: unknown }).output,
          })),
        });
      }
    }
  }

  console.log("\nRequest format:");
  console.log(JSON.stringify({ text: userMessage }, null, 2));

  console.log("\nResponse format:");
  console.log(JSON.stringify(events, null, 2));

  console.log("\n" + "=".repeat(80));
  console.log("ANALYSIS");
  console.log("=".repeat(80));
  console.log(`Total steps: ${steps?.length || 0}`);
  console.log(`Events generated: ${events.length}`);
  console.log(
    `- llmThought events: ${events.filter((e) => "llmThought" in e).length}`,
  );
  console.log(
    `- llmOutput events: ${events.filter((e) => "llmOutput" in e).length}`,
  );
  console.log(
    `- toolCalls events: ${events.filter((e) => "toolCalls" in e).length}`,
  );
  console.log(
    `- toolResults events: ${events.filter((e) => "toolResults" in e).length}`,
  );

  // Check if the model provides reasoning
  const hasReasoning = steps?.some((s) => {
    const stepAny = s as Record<string, unknown>;
    return (
      stepAny.reasoning &&
      Array.isArray(stepAny.reasoning) &&
      stepAny.reasoning.length > 0
    );
  });

  console.log(`\n--- Reasoning Support ---`);
  console.log(`Model provides reasoning: ${hasReasoning ? "YES" : "NO"}`);
  if (!hasReasoning) {
    console.log(
      "This model's reasoning field is empty. All text goes to llmOutput.",
    );
    console.log(
      "For reasoning models (DeepSeek-R1, o1), reasoning would appear in llmThought.",
    );
  }

  console.log("\n" + "=".repeat(80));
  console.log("onStepFinish TIMING ANALYSIS");
  console.log("=".repeat(80));
  const streamEndTime = Date.now() - startTime;
  console.log(`Stream completed at: ${streamEndTime}ms`);
  console.log(`\nStep finish events:`);
  for (const step of stepFinishTimes) {
    console.log(
      `  Step ${step.stepIndex + 1}: fired at ${step.timestamp}ms (text: ${step.hasText}, toolCalls: ${step.toolCallCount})`,
    );
  }

  if (stepFinishTimes.length > 0) {
    const lastStepTime = stepFinishTimes[stepFinishTimes.length - 1].timestamp;
    console.log(
      `\nKey insight: onStepFinish fires ${streamEndTime - lastStepTime}ms BEFORE stream ends`,
    );
    console.log(
      "This means we CAN save events incrementally as each step completes!",
    );
  }

  console.log("\n" + "=".repeat(80));
  console.log("FINAL FORMAT SUMMARY");
  console.log("=".repeat(80));
  console.log(`
llm_interactions.request:
  { text: "user message" }

llm_interactions.response (event-based array):
  [
    { llmThought: "..." },     // From reasoning models (optional)
    { llmOutput: "..." },      // Text shown to user
    { toolCalls: [...] },      // Tool invocations
    { toolResults: [...] },    // Tool results
    // ... events in chronological order
  ]

Event types:
  - llmThought: Internal reasoning (from reasoning models)
  - llmOutput: Text visible to user
  - toolCalls: Array of { toolName, args }
  - toolResults: Array of { toolName, result }

INCREMENTAL SAVE APPROACH:
  - Use onStepFinish callback to save events after each step
  - Each step contains: text + toolCalls + toolResults for that step
  - Save accumulated events to database after each step completes
`);
}

main().catch(console.error);
