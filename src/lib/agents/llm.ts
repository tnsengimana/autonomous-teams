import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  streamText,
  generateText,
  generateObject,
  stepCountIs,
  type Tool as AITool,
} from "ai";
import { z } from "zod";
import {
  getUserApiKeyForProvider,
  decryptApiKey,
} from "@/lib/db/queries/userApiKeys";
import { getTeamUserId } from "@/lib/db/queries/teams";
import type { LLMProvider, LLMMessage } from "@/lib/types";
import {
  type Tool,
  type ToolContext,
  type ToolParameter,
  executeTool,
} from "@/lib/agents/tools";

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_MODEL = {
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-20250514",
  google: "gemini-3-flash-preview", // Using flash as default since pro has reliability issues
  lmstudio: "mistralai/ministral-3-14b-reasoning",
} as const;

const FALLBACK_MODEL = {
  google: "gemini-3-pro-preview", // Pro as fallback when flash fails
} as const;

// Check mock mode dynamically to support testing
const isMockEnabled = () => process.env.MOCK_LLM === "true";

// ============================================================================
// Provider Creation
// ============================================================================

/**
 * Get the API key for a provider, checking user keys first, then env vars
 */
async function getApiKey(
  provider: LLMProvider,
  userId?: string,
): Promise<string | null> {
  // First try user's API key if userId is provided
  if (userId) {
    const userKey = await getUserApiKeyForProvider(userId, provider);
    if (userKey) {
      return decryptApiKey(userKey.encryptedKey);
    }
  }

  // Fall back to environment variables
  if (provider === "openai") {
    return process.env.OPENAI_API_KEY ?? null;
  }
  if (provider === "anthropic") {
    return process.env.ANTHROPIC_API_KEY ?? null;
  }
  if (provider === "google") {
    return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? null;
  }
  if (provider === "lmstudio") {
    // LM Studio doesn't need an API key (local server)
    return null;
  }

  return null;
}

/**
 * Create an OpenAI provider instance
 */
async function createOpenAIProvider(userId?: string) {
  const apiKey = await getApiKey("openai", userId);
  if (!apiKey) {
    throw new Error("No OpenAI API key available");
  }
  return createOpenAI({ apiKey });
}

/**
 * Create an Anthropic provider instance
 */
async function createAnthropicProvider(userId?: string) {
  const apiKey = await getApiKey("anthropic", userId);
  if (!apiKey) {
    throw new Error("No Anthropic API key available");
  }
  return createAnthropic({ apiKey });
}

/**
 * Create a Google (Gemini) provider instance
 */
async function createGoogleProvider(userId?: string) {
  const apiKey = await getApiKey("google", userId);
  if (!apiKey) {
    throw new Error("No Google/Gemini API key available");
  }
  return createGoogleGenerativeAI({ apiKey });
}

/**
 * Create an LM Studio provider instance (local OpenAI-compatible server)
 */
function createLMStudioProvider() {
  const baseURL = process.env.LMSTUDIO_BASE_URL;
  if (!baseURL) {
    throw new Error("LMSTUDIO_BASE_URL is not defined");
  }
  return createOpenAICompatible({
    name: "lmstudio",
    baseURL,
    supportsStructuredOutputs: true,
  });
}

// ============================================================================
// Mock LLM for Development
// ============================================================================

const MOCK_RESPONSES = [
  "I understand your question. Based on my analysis, I recommend proceeding with caution while monitoring the situation closely.",
  "Thank you for sharing that information. I've noted this for future reference and will factor it into my recommendations.",
  "That's an interesting point. Let me think about this more carefully before providing my assessment.",
  "I've reviewed the available data and believe this aligns with our strategic objectives. Would you like me to elaborate?",
  "Based on my current understanding, I suggest we take a measured approach here. Let me know if you'd like more details.",
];

function getMockResponse(): string {
  return MOCK_RESPONSES[Math.floor(Math.random() * MOCK_RESPONSES.length)];
}

async function* mockStreamResponse(): AsyncGenerator<string> {
  const response = getMockResponse();
  const words = response.split(" ");
  for (const word of words) {
    yield word + " ";
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// ============================================================================
// LLM Interface
// ============================================================================

export interface StreamOptions {
  provider?: LLMProvider;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  userId?: string;
  teamId?: string;
  aideId?: string;
}

export interface GenerateOptions extends StreamOptions {
  schema?: z.ZodType;
}

export interface StreamWithToolsOptions extends StreamOptions {
  tools: Tool[];
  toolContext: ToolContext;
  maxSteps?: number;
}

export interface StreamWithToolsResult {
  textStream: AsyncIterable<string>;
  fullResponse: Promise<{
    text: string;
    toolCalls: Array<{
      toolName: string;
      args: Record<string, unknown>;
    }>;
    toolResults: Array<{
      toolName: string;
      result: unknown;
    }>;
  }>;
}

// ============================================================================
// Tool Format Conversion
// ============================================================================

/**
 * Convert a ToolParameter type to a Zod schema type
 */
function parameterTypeToZod(param: ToolParameter): z.ZodTypeAny {
  let schema: z.ZodTypeAny;

  switch (param.type) {
    case "string":
      if (param.enum && param.enum.length > 0) {
        // Create enum schema for parameters with enum values
        schema = z.enum(param.enum as [string, ...string[]]);
      } else {
        schema = z.string();
      }
      break;
    case "number":
      schema = z.number();
      break;
    case "boolean":
      schema = z.boolean();
      break;
    case "object":
      schema = z.record(z.string(), z.unknown());
      break;
    case "array":
      schema = z.array(z.unknown());
      break;
    default:
      schema = z.unknown();
  }

  // Add description
  schema = schema.describe(param.description);

  // Make optional if not required
  if (param.required === false) {
    schema = schema.optional();
  }

  return schema;
}

/**
 * Convert Tool[] to Vercel AI SDK's tool format
 *
 * The Vercel AI SDK expects tools as a Record<string, Tool> where each Tool has:
 * - description: string (optional)
 * - inputSchema: Zod schema or JSON schema
 * - execute: async function
 */
function convertToolsToVercelFormat(
  tools: Tool[],
  toolContext: ToolContext,
): Record<string, AITool<Record<string, unknown>, unknown>> {
  const vercelTools: Record<
    string,
    AITool<Record<string, unknown>, unknown>
  > = {};

  for (const tool of tools) {
    const { schema } = tool;

    // Build Zod schema from parameters
    const schemaShape: Record<string, z.ZodTypeAny> = {};
    for (const param of schema.parameters) {
      schemaShape[param.name] = parameterTypeToZod(param);
    }

    const parametersSchema = z.object(schemaShape);

    // Create Tool with inputSchema and execute function
    // The AITool type uses inputSchema (not parameters) in newer AI SDK versions
    vercelTools[schema.name] = {
      description: schema.description,
      inputSchema: parametersSchema,
      execute: async (args: Record<string, unknown>) => {
        console.log(
          `[Tool] Executing ${schema.name} with args:`,
          JSON.stringify(args),
        );
        const result = await executeTool(schema.name, args, toolContext);
        console.log(
          `[Tool] ${schema.name} result:`,
          result.success ? "success" : `failed: ${result.error}`,
        );
        // Return just the data on success, or throw on failure
        // so the LLM can see tool errors and potentially retry
        if (!result.success) {
          throw new Error(result.error || "Tool execution failed");
        }
        return result.data;
      },
    };
  }

  return vercelTools;
}

/**
 * Stream a response from the LLM
 */
export async function streamLLMResponse(
  messages: LLMMessage[],
  systemPrompt?: string,
  options: StreamOptions = {},
): Promise<AsyncIterable<string>> {
  // Mock mode for development
  if (isMockEnabled()) {
    return mockStreamResponse();
  }

  // Auto-detect provider if not specified
  let provider = options.provider;
  if (!provider) {
    provider = await getDefaultProvider(options.userId);
    if (!provider) {
      throw new Error(
        "No LLM provider available. Please configure an API key.",
      );
    }
  }

  // Get userId from teamId if not directly provided
  let userId = options.userId;
  if (!userId && options.teamId) {
    userId = (await getTeamUserId(options.teamId)) ?? undefined;
  }

  const model = options.model ?? DEFAULT_MODEL[provider];

  if (provider === "openai") {
    const openai = await createOpenAIProvider(userId);
    const result = streamText({
      model: openai(model),
      messages,
      system: systemPrompt,
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
    });

    return result.textStream;
  }

  if (provider === "anthropic") {
    const anthropic = await createAnthropicProvider(userId);
    const result = streamText({
      model: anthropic(model),
      messages,
      system: systemPrompt,
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
    });

    return result.textStream;
  }

  if (provider === "google") {
    const google = await createGoogleProvider(userId);
    const result = streamText({
      model: google(model),
      messages,
      system: systemPrompt,
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
    });

    return result.textStream;
  }

  if (provider === "lmstudio") {
    const lmstudio = createLMStudioProvider();
    const result = streamText({
      model: lmstudio(model),
      messages,
      system: systemPrompt,
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
    });

    return result.textStream;
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

/**
 * Stream a response from the LLM with tool calling support
 *
 * This function enables multi-turn tool calling where the model can:
 * 1. Call tools to gather information or take actions
 * 2. Receive tool results and continue reasoning
 * 3. Repeat until it produces a final text response
 *
 * @param messages - The conversation history
 * @param systemPrompt - The system prompt for the agent (can be undefined)
 * @param options - Configuration including tools and tool context
 * @returns StreamWithToolsResult with both the text stream and a promise for the full response
 */
export async function streamLLMResponseWithTools(
  messages: LLMMessage[],
  systemPrompt: string | undefined,
  options: StreamWithToolsOptions,
): Promise<StreamWithToolsResult> {
  const { tools, toolContext, maxSteps = 5 } = options;

  // Mock mode for development - just return text without tool calls
  if (isMockEnabled()) {
    const mockText = getMockResponse();
    const mockStream = (async function* () {
      const words = mockText.split(" ");
      for (const word of words) {
        yield word + " ";
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    })();
    return {
      textStream: mockStream,
      fullResponse: Promise.resolve({
        text: mockText,
        toolCalls: [],
        toolResults: [],
      }),
    };
  }

  // Auto-detect provider if not specified
  let provider = options.provider;
  if (!provider) {
    provider = await getDefaultProvider(options.userId);
    if (!provider) {
      throw new Error(
        "No LLM provider available. Please configure an API key.",
      );
    }
  }

  // Get userId from teamId if not directly provided
  let userId = options.userId;
  if (!userId && options.teamId) {
    userId = (await getTeamUserId(options.teamId)) ?? undefined;
  }

  const model = options.model ?? DEFAULT_MODEL[provider];

  // Convert tools to Vercel AI SDK format
  const vercelTools = convertToolsToVercelFormat(tools, toolContext);

  // Debug: Log tools being passed
  console.log(
    `[LLM] Tool calling enabled with ${Object.keys(vercelTools).length} tools:`,
    Object.keys(vercelTools),
  );
  console.log(
    `[LLM] Using provider: ${provider}, model: ${model}, maxSteps: ${maxSteps}`,
  );

  // Helper to call streamText with tools for any provider
  async function callStreamTextWithTools(
    providerModel: ReturnType<
      | ReturnType<typeof createOpenAI>
      | ReturnType<typeof createAnthropic>
      | ReturnType<typeof createGoogleGenerativeAI>
    >,
  ) {
    const result = streamText({
      model: providerModel,
      messages,
      system: systemPrompt,
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
      tools: vercelTools,
      toolChoice: "auto",
      // stopWhen controls how many tool-calling rounds can happen
      // Default is stepCountIs(1) which stops after first step
      // We allow up to maxSteps for multi-turn tool calling
      stopWhen: stepCountIs(maxSteps),
    });

    // Collect all text chunks to build the full response
    let fullText = "";
    const collectedToolCalls: Array<{
      toolName: string;
      args: Record<string, unknown>;
    }> = [];
    const collectedToolResults: Array<{ toolName: string; result: unknown }> =
      [];

    // Create a wrapped stream that collects data as it's consumed
    const wrappedStream = (async function* () {
      for await (const chunk of result.textStream) {
        fullText += chunk;
        yield chunk;
      }

      // After stream completes, collect tool data
      const response = await result;
      const toolCallsRaw = await response.toolCalls;
      const toolResultsRaw = await response.toolResults;

      for (const tc of toolCallsRaw || []) {
        collectedToolCalls.push({
          toolName: tc.toolName,
          args: tc.input as Record<string, unknown>,
        });
      }
      for (const tr of toolResultsRaw || []) {
        collectedToolResults.push({
          toolName: tr.toolName,
          result: tr.output,
        });
      }

      // Debug: Log tool call summary
      console.log(
        `[LLM] Stream complete. Tool calls: ${collectedToolCalls.length}, Tool results: ${collectedToolResults.length}`,
      );
      if (collectedToolCalls.length > 0) {
        console.log(
          `[LLM] Tool calls made:`,
          collectedToolCalls.map((tc) => tc.toolName),
        );
      }
    })();

    // Create a promise that resolves when stream is fully consumed
    const fullResponsePromise = (async () => {
      // Consume the stream to completion
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of wrappedStream) {
        // Just consume, data is collected in wrappedStream
      }
      return {
        text: fullText,
        toolCalls: collectedToolCalls,
        toolResults: collectedToolResults,
      };
    })();

    return {
      textStream: wrappedStream,
      fullResponse: fullResponsePromise,
    };
  }

  if (provider === "openai") {
    const openai = await createOpenAIProvider(userId);
    return callStreamTextWithTools(openai(model));
  }

  if (provider === "anthropic") {
    const anthropic = await createAnthropicProvider(userId);
    return callStreamTextWithTools(anthropic(model));
  }

  if (provider === "google") {
    const google = await createGoogleProvider(userId);
    return callStreamTextWithTools(google(model));
  }

  if (provider === "lmstudio") {
    const lmstudio = createLMStudioProvider();
    return callStreamTextWithTools(lmstudio(model));
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

/**
 * Generate a complete response from the LLM (non-streaming)
 */
export async function generateLLMResponse(
  messages: LLMMessage[],
  systemPrompt?: string,
  options: StreamOptions = {},
): Promise<{ content: string; thinking?: string }> {
  // Mock mode for development
  if (isMockEnabled()) {
    return { content: getMockResponse() };
  }

  // Auto-detect provider if not specified
  let provider = options.provider;
  if (!provider) {
    provider = await getDefaultProvider(options.userId);
    if (!provider) {
      throw new Error(
        "No LLM provider available. Please configure an API key.",
      );
    }
  }

  // Get userId from teamId if not directly provided
  let userId = options.userId;
  if (!userId && options.teamId) {
    userId = (await getTeamUserId(options.teamId)) ?? undefined;
  }

  const model = options.model ?? DEFAULT_MODEL[provider];

  if (provider === "openai") {
    const openai = await createOpenAIProvider(userId);
    const result = await generateText({
      model: openai(model),
      messages,
      system: systemPrompt,
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
    });

    return { content: result.text };
  }

  if (provider === "anthropic") {
    const anthropic = await createAnthropicProvider(userId);
    const result = await generateText({
      model: anthropic(model),
      messages,
      system: systemPrompt,
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
    });

    return { content: result.text };
  }

  if (provider === "google") {
    const google = await createGoogleProvider(userId);
    const result = await generateText({
      model: google(model),
      messages,
      system: systemPrompt,
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
    });

    return { content: result.text };
  }

  if (provider === "lmstudio") {
    const lmstudio = createLMStudioProvider();
    const result = await generateText({
      model: lmstudio(model),
      messages,
      system: systemPrompt,
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
    });

    return { content: result.text };
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

/**
 * Generate a structured object from the LLM
 */
export async function generateLLMObject<T>(
  messages: LLMMessage[],
  schema: z.ZodType<T>,
  systemPrompt?: string,
  options: StreamOptions = {},
): Promise<T> {
  // Mock mode for development - return valid mock objects for common schemas
  if (isMockEnabled()) {
    // Try common mock values in order of likelihood
    const mockValues = [
      // Memory extraction result
      { memories: [] },
      // Knowledge extraction result
      { knowledgeItems: [] },
      // Briefing decision (no briefing)
      { shouldBrief: false, reason: "Mock mode - no briefing" },
      // User intent classification (default to regular_chat for most messages)
      {
        intent: "regular_chat",
        reasoning: "Mock mode - default to regular chat",
      },
      // Team configuration generation
      {
        teamDescription:
          "A team dedicated to achieving its mission through autonomous collaboration.",
        leadAgentName: "Alex",
        leadAgentSystemPrompt:
          "You are a capable team lead responsible for coordinating work and achieving the team mission. You communicate clearly, delegate effectively, and ensure quality outcomes.",
      },
      // Empty array (fallback)
      [],
      // Empty object (fallback)
      {},
    ];

    for (const mockValue of mockValues) {
      try {
        return schema.parse(mockValue) as T;
      } catch {
        // Try next mock value
      }
    }

    // Last resort - let it fail naturally
    throw new Error("Mock mode cannot satisfy schema");
  }

  // Auto-detect provider if not specified
  let provider = options.provider;
  if (!provider) {
    provider = await getDefaultProvider(options.userId);
    if (!provider) {
      throw new Error(
        "No LLM provider available. Please configure an API key.",
      );
    }
  }

  // Get userId from teamId if not directly provided
  let userId = options.userId;
  if (!userId && options.teamId) {
    userId = (await getTeamUserId(options.teamId)) ?? undefined;
  }

  const model = options.model ?? DEFAULT_MODEL[provider];

  if (provider === "openai") {
    const openai = await createOpenAIProvider(userId);
    const result = await generateObject({
      model: openai(model),
      messages,
      system: systemPrompt,
      schema,
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
    });

    return result.object;
  }

  if (provider === "anthropic") {
    const anthropic = await createAnthropicProvider(userId);
    const result = await generateObject({
      model: anthropic(model),
      messages,
      system: systemPrompt,
      schema,
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
    });

    return result.object;
  }

  if (provider === "google") {
    const google = await createGoogleProvider(userId);

    // Try primary model first, fall back to flash model if it fails
    try {
      console.log(`[LLM] generateObject using model: ${model}`);
      const result = await generateObject({
        model: google(model),
        messages,
        system: systemPrompt,
        schema,
        temperature: options.temperature,
        maxOutputTokens: options.maxOutputTokens,
      });
      return result.object;
    } catch (error) {
      const fallbackModel = FALLBACK_MODEL.google;
      if (model !== fallbackModel) {
        console.log(
          `[LLM] Primary model ${model} failed, falling back to ${fallbackModel}:`,
          error,
        );
        const result = await generateObject({
          model: google(fallbackModel),
          messages,
          system: systemPrompt,
          schema,
          temperature: options.temperature,
          maxOutputTokens: options.maxOutputTokens,
        });
        return result.object;
      }
      throw error;
    }
  }

  if (provider === "lmstudio") {
    const lmstudio = createLMStudioProvider();
    const result = await generateObject({
      model: lmstudio(model),
      messages,
      system: systemPrompt,
      schema,
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
    });

    return result.object;
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

/**
 * Check if a provider is available (has API key configured)
 */
export async function isProviderAvailable(
  provider: LLMProvider,
  userId?: string,
): Promise<boolean> {
  // LM Studio doesn't need an API key, just check if base URL is configured
  if (provider === "lmstudio") {
    return process.env.LMSTUDIO_BASE_URL !== undefined;
  }
  const apiKey = await getApiKey(provider, userId);
  return apiKey !== null;
}

/**
 * Get the default provider based on available API keys
 */
export async function getDefaultProvider(
  userId?: string,
): Promise<LLMProvider | undefined> {
  // Check available providers in priority order
  // TODO: Need to move this in the UI as the user configuration
  if (await isProviderAvailable("lmstudio", userId)) {
    return "lmstudio";
  }
  if (await isProviderAvailable("google", userId)) {
    return "google";
  }
  if (await isProviderAvailable("openai", userId)) {
    return "openai";
  }
  if (await isProviderAvailable("anthropic", userId)) {
    return "anthropic";
  }
  return undefined;
}
