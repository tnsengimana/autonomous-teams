import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { streamText, generateText, generateObject } from 'ai';
import { z } from 'zod';
import {
  getUserApiKeyForProvider,
  decryptApiKey,
} from '@/lib/db/queries/userApiKeys';
import { getTeamUserId } from '@/lib/db/queries/teams';
import type { LLMProvider, LLMMessage } from '@/lib/types';

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
): Promise<LLMProvider | null> {
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
  return null;
}
