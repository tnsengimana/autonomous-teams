import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { streamText, generateText, generateObject, stepCountIs, type Tool as AITool } from 'ai';
import { z } from 'zod';
import {
  getUserApiKeyForProvider,
  decryptApiKey,
} from '@/lib/db/queries/userApiKeys';
import { getTeamUserId } from '@/lib/db/queries/teams';
import type { LLMProvider, LLMMessage } from '@/lib/types';
import {
  type Tool,
  type ToolContext,
  type ToolParameter,
  executeTool,
} from '@/lib/agents/tools';

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_MODEL = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-20250514',
  google: 'gemini-3-pro-preview',
} as const;

const MOCK_ENABLED = process.env.MOCK_LLM === 'true';

// ============================================================================
// Provider Creation
// ============================================================================

/**
 * Get the API key for a provider, checking user keys first, then env vars
 */
async function getApiKey(
  provider: LLMProvider,
  userId?: string
): Promise<string | null> {
  // First try user's API key if userId is provided
  if (userId) {
    const userKey = await getUserApiKeyForProvider(userId, provider);
    if (userKey) {
      return decryptApiKey(userKey.encryptedKey);
    }
  }

  // Fall back to environment variables
  if (provider === 'openai') {
    return process.env.OPENAI_API_KEY ?? null;
  }
  if (provider === 'anthropic') {
    return process.env.ANTHROPIC_API_KEY ?? null;
  }
  if (provider === 'google') {
    return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? null;
  }

  return null;
}

/**
 * Create an OpenAI provider instance
 */
async function createOpenAIProvider(userId?: string) {
  const apiKey = await getApiKey('openai', userId);
  if (!apiKey) {
    throw new Error('No OpenAI API key available');
  }
  return createOpenAI({ apiKey });
}

/**
 * Create an Anthropic provider instance
 */
async function createAnthropicProvider(userId?: string) {
  const apiKey = await getApiKey('anthropic', userId);
  if (!apiKey) {
    throw new Error('No Anthropic API key available');
  }
  return createAnthropic({ apiKey });
}

/**
 * Create a Google (Gemini) provider instance
 */
async function createGoogleProvider(userId?: string) {
  const apiKey = await getApiKey('google', userId);
  if (!apiKey) {
    throw new Error('No Google/Gemini API key available');
  }
  return createGoogleGenerativeAI({ apiKey });
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
  const words = response.split(' ');
  for (const word of words) {
    yield word + ' ';
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
    case 'string':
      if (param.enum && param.enum.length > 0) {
        // Create enum schema for parameters with enum values
        schema = z.enum(param.enum as [string, ...string[]]);
      } else {
        schema = z.string();
      }
      break;
    case 'number':
      schema = z.number();
      break;
    case 'boolean':
      schema = z.boolean();
      break;
    case 'object':
      schema = z.record(z.string(), z.unknown());
      break;
    case 'array':
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
  toolContext: ToolContext
): Record<string, AITool<Record<string, unknown>, unknown>> {
  const vercelTools: Record<string, AITool<Record<string, unknown>, unknown>> = {};

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
        const result = await executeTool(schema.name, args, toolContext);
        // Return just the data on success, or throw on failure
        // so the LLM can see tool errors and potentially retry
        if (!result.success) {
          throw new Error(result.error || 'Tool execution failed');
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
  options: StreamOptions = {}
): Promise<AsyncIterable<string>> {
  // Mock mode for development
  if (MOCK_ENABLED) {
    return mockStreamResponse();
  }

  // Auto-detect provider if not specified
  let provider = options.provider;
  if (!provider) {
    provider = await getDefaultProvider(options.userId);
    if (!provider) {
      throw new Error('No LLM provider available. Please configure an API key.');
    }
  }

  // Get userId from teamId if not directly provided
  let userId = options.userId;
  if (!userId && options.teamId) {
    userId = (await getTeamUserId(options.teamId)) ?? undefined;
  }

  const model = options.model ?? DEFAULT_MODEL[provider];

  if (provider === 'openai') {
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

  if (provider === 'anthropic') {
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

  if (provider === 'google') {
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
  options: StreamWithToolsOptions
): Promise<StreamWithToolsResult> {
  const { tools, toolContext, maxSteps = 5 } = options;

  // Mock mode for development - just return text without tool calls
  if (MOCK_ENABLED) {
    const mockText = getMockResponse();
    const mockStream = (async function* () {
      const words = mockText.split(' ');
      for (const word of words) {
        yield word + ' ';
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
      throw new Error('No LLM provider available. Please configure an API key.');
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

  // Helper to call streamText with tools for any provider
  async function callStreamTextWithTools(
    providerModel: ReturnType<
      | ReturnType<typeof createOpenAI>
      | ReturnType<typeof createAnthropic>
      | ReturnType<typeof createGoogleGenerativeAI>
    >
  ) {
    const result = streamText({
      model: providerModel,
      messages,
      system: systemPrompt,
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
      tools: vercelTools,
      toolChoice: 'auto',
      // stopWhen controls how many tool-calling rounds can happen
      // Default is stepCountIs(1) which stops after first step
      // We allow up to maxSteps for multi-turn tool calling
      stopWhen: stepCountIs(maxSteps),
    });

    // Create a wrapper that extracts tool call information
    const fullResponsePromise = (async () => {
      // Wait for the stream to complete and get the full response
      const response = await result;
      const text = await response.text;
      const toolCallsRaw = await response.toolCalls;
      const toolResultsRaw = await response.toolResults;

      return {
        text,
        toolCalls: (toolCallsRaw || []).map((tc) => ({
          toolName: tc.toolName,
          args: tc.input as Record<string, unknown>,
        })),
        toolResults: (toolResultsRaw || []).map((tr) => ({
          toolName: tr.toolName,
          result: tr.output,
        })),
      };
    })();

    return {
      textStream: result.textStream,
      fullResponse: fullResponsePromise,
    };
  }

  if (provider === 'openai') {
    const openai = await createOpenAIProvider(userId);
    return callStreamTextWithTools(openai(model));
  }

  if (provider === 'anthropic') {
    const anthropic = await createAnthropicProvider(userId);
    return callStreamTextWithTools(anthropic(model));
  }

  if (provider === 'google') {
    const google = await createGoogleProvider(userId);
    return callStreamTextWithTools(google(model));
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

/**
 * Generate a complete response from the LLM (non-streaming)
 */
export async function generateLLMResponse(
  messages: LLMMessage[],
  systemPrompt?: string,
  options: StreamOptions = {}
): Promise<{ content: string; thinking?: string }> {
  // Mock mode for development
  if (MOCK_ENABLED) {
    return { content: getMockResponse() };
  }

  // Auto-detect provider if not specified
  let provider = options.provider;
  if (!provider) {
    provider = await getDefaultProvider(options.userId);
    if (!provider) {
      throw new Error('No LLM provider available. Please configure an API key.');
    }
  }

  // Get userId from teamId if not directly provided
  let userId = options.userId;
  if (!userId && options.teamId) {
    userId = (await getTeamUserId(options.teamId)) ?? undefined;
  }

  const model = options.model ?? DEFAULT_MODEL[provider];

  if (provider === 'openai') {
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

  if (provider === 'anthropic') {
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

  if (provider === 'google') {
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

  throw new Error(`Unsupported provider: ${provider}`);
}

/**
 * Generate a structured object from the LLM
 */
export async function generateLLMObject<T>(
  messages: LLMMessage[],
  schema: z.ZodType<T>,
  systemPrompt?: string,
  options: StreamOptions = {}
): Promise<T> {
  // Mock mode for development - return empty array for memory extraction
  if (MOCK_ENABLED) {
    // If the schema looks like it expects an array (memories), return empty array
    // Otherwise return a basic object
    try {
      return schema.parse([]) as T;
    } catch {
      // If parsing [] fails, try parsing an empty object
      try {
        return schema.parse({}) as T;
      } catch {
        // Last resort - let it fail naturally
        throw new Error('Mock mode cannot satisfy schema');
      }
    }
  }

  // Auto-detect provider if not specified
  let provider = options.provider;
  if (!provider) {
    provider = await getDefaultProvider(options.userId);
    if (!provider) {
      throw new Error('No LLM provider available. Please configure an API key.');
    }
  }

  // Get userId from teamId if not directly provided
  let userId = options.userId;
  if (!userId && options.teamId) {
    userId = (await getTeamUserId(options.teamId)) ?? undefined;
  }

  const model = options.model ?? DEFAULT_MODEL[provider];

  if (provider === 'openai') {
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

  if (provider === 'anthropic') {
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

  if (provider === 'google') {
    const google = await createGoogleProvider(userId);
    const result = await generateObject({
      model: google(model),
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
  userId?: string
): Promise<boolean> {
  const apiKey = await getApiKey(provider, userId);
  return apiKey !== null;
}

/**
 * Get the default provider based on available API keys
 */
export async function getDefaultProvider(
  userId?: string
): Promise<LLMProvider | undefined> {
  // Check available providers in priority order
  // Google/Gemini first (most reliable free tier), then OpenAI, then Anthropic
  if (await isProviderAvailable('google', userId)) {
    return 'google';
  }
  if (await isProviderAvailable('openai', userId)) {
    return 'openai';
  }
  if (await isProviderAvailable('anthropic', userId)) {
    return 'anthropic';
  }
  return undefined;
}
