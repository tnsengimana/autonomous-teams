/**
 * Web Tools
 *
 * Web search and extraction tools powered by Tavily API.
 * These tools require a Tavily API key to be configured for the user.
 */

import { z } from 'zod';
import {
  registerTool,
  type Tool,
  type ToolResult,
} from './index';

// ============================================================================
// Zod Schemas for Web Tool Parameters
// ============================================================================

export const WebSearchParamsSchema = z.object({
  query: z.string().min(1).describe('The search query'),
  maxResults: z.number().min(1).max(20).optional().default(5).describe('Maximum number of results to return'),
  searchDepth: z.enum(['basic', 'advanced']).optional().default('basic').describe('Search depth: basic for quick searches, advanced for more comprehensive results'),
  includeAnswer: z.boolean().optional().default(true).describe('Whether to include an AI-generated answer summary'),
});

export const WebExtractParamsSchema = z.object({
  url: z.string().url().describe('The URL to extract content from'),
});

export type WebSearchParams = z.infer<typeof WebSearchParamsSchema>;
export type WebExtractParams = z.infer<typeof WebExtractParamsSchema>;

// ============================================================================
// Helper Functions
// ============================================================================

import type { ToolContext } from './index';

async function getTavilyApiKeyFromContext(context: ToolContext): Promise<string | null> {
  // First try environment variable
  if (process.env.TAVILY_API_KEY) {
    return process.env.TAVILY_API_KEY;
  }

  // Then try to get from user's stored keys via agent
  try {
    const { getUserApiKeyForProvider, decryptApiKey } = await import(
      '@/lib/db/queries/userApiKeys'
    );

    const { getAgentUserId } = await import('@/lib/db/queries/agents');
    const userId = await getAgentUserId(context.agentId);

    if (!userId) {
      return null;
    }

    // Check for 'tavily' provider key - extend LLMProvider type if needed
    const apiKeyRecord = await getUserApiKeyForProvider(
      userId,
      'tavily' as 'openai' | 'anthropic'
    );

    if (apiKeyRecord) {
      return decryptApiKey(apiKeyRecord.encryptedKey);
    }
  } catch {
    // Fall through to return null
  }

  return null;
}

interface WebSearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface WebSearchResponse {
  answer?: string;
  results: WebSearchResult[];
}

type WebExtractResult = {
  url: string;
  raw_content?: string | null;
};

type WebExtractResponse = {
  results?: WebExtractResult[];
};

async function callTavilyAPI(
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const baseUrl = 'https://api.tavily.com';

  const response = await fetch(`${baseUrl}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      api_key: apiKey,
      ...body,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Tavily API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

// ============================================================================
// search Tool
// ============================================================================

const searchTool: Tool = {
  schema: {
    name: 'webSearch',
    description: 'Search the web. Returns relevant results and optionally an AI-generated answer summary.',
    parameters: [
      {
        name: 'query',
        type: 'string',
        description: 'The search query',
        required: true,
      },
      {
        name: 'maxResults',
        type: 'number',
        description: 'Maximum number of results to return (1-20, default 5)',
        required: false,
      },
      {
        name: 'searchDepth',
        type: 'string',
        description: 'Search depth: "basic" for quick, "advanced" for comprehensive',
        required: false,
        enum: ['basic', 'advanced'],
      },
      {
        name: 'includeAnswer',
        type: 'boolean',
        description: 'Whether to include an AI-generated answer summary',
        required: false,
      },
    ],
  },
  handler: async (params, context): Promise<ToolResult> => {
    const parsed = WebSearchParamsSchema.safeParse(params);
    if (!parsed.success) {
      return {
        success: false,
        error: `Invalid parameters: ${parsed.error.message}`,
      };
    }

    const apiKey = await getTavilyApiKeyFromContext(context);
    if (!apiKey) {
      return {
        success: false,
        error: 'Tavily API key not configured. Please add your Tavily API key in settings.',
      };
    }

    try {
      const { query, maxResults, searchDepth, includeAnswer } = parsed.data;

      const response = await callTavilyAPI('search', apiKey, {
        query,
        max_results: maxResults,
        search_depth: searchDepth,
        include_answer: includeAnswer,
      }) as WebSearchResponse;

      return {
        success: true,
        data: {
          answer: response.answer,
          results: response.results.map((r) => ({
            title: r.title,
            url: r.url,
            snippet: r.content.substring(0, 500),
            relevanceScore: r.score,
          })),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Search failed',
      };
    }
  },
};

// ============================================================================
// extract Tool
// ============================================================================

const extractTool: Tool = {
  schema: {
    name: 'webExtract',
    description: 'Extract clean content from a webpage URL.',
    parameters: [
      {
        name: 'url',
        type: 'string',
        description: 'The URL to extract content from',
        required: true,
      },
    ],
  },
  handler: async (params, context): Promise<ToolResult> => {
    const parsed = WebExtractParamsSchema.safeParse(params);
    if (!parsed.success) {
      return {
        success: false,
        error: `Invalid parameters: ${parsed.error.message}`,
      };
    }

    const apiKey = await getTavilyApiKeyFromContext(context);
    if (!apiKey) {
      return {
        success: false,
        error: 'Tavily API key not configured. Please add your Tavily API key in settings.',
      };
    }

    try {
      const { url } = parsed.data;

      // Tavily's extract endpoint
      const response = await callTavilyAPI('extract', apiKey, {
        urls: [url],
      }) as WebExtractResponse;

      const result = response.results?.[0];
      const extractedContent = result?.raw_content?.trim() ?? '';

      if (!result || extractedContent.length === 0) {
        console.warn('[Web][WARN][extract] No extractable content returned', {
          url,
        });
        return {
          success: true,
          data: {
            url,
            content: null,
            extractionStatus: 'no_content',
            recoverable: true,
            error: {
              code: 'EXTRACTION_EMPTY',
              message: 'No content extracted from URL',
            },
          },
        };
      }

      return {
        success: true,
        data: {
          url: result.url,
          content: result.raw_content,
          extractionStatus: 'ok',
        },
      };
    } catch (error) {
      const { url } = parsed.data;
      const message = error instanceof Error ? error.message : 'Extraction failed';
      const isTimeout =
        /UND_ERR_BODY_TIMEOUT/i.test(message) || /timeout/i.test(message);
      const code = isTimeout ? 'EXTRACTION_TIMEOUT' : 'EXTRACTION_FAILED';

      console.warn('[Web][WARN][extract] Recoverable extraction failure', {
        url,
        code,
        message,
      });

      return {
        success: true,
        data: {
          url,
          content: null,
          extractionStatus: 'failed',
          recoverable: true,
          error: {
            code,
            message,
          },
        },
      };
    }
  },
};

// ============================================================================
// Registration
// ============================================================================

/**
 * Register all web tools.
 */
export function registerWebTools(): void {
  registerTool(searchTool);
  registerTool(extractTool);
}

// Export individual tools for testing
export { searchTool, extractTool };
