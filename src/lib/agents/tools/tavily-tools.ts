/**
 * Tavily Tools
 *
 * Web search and research tools powered by Tavily API.
 * These tools require a Tavily API key to be configured for the user.
 */

import { z } from 'zod';
import {
  registerTool,
  type Tool,
  type ToolResult,
} from './index';

// ============================================================================
// Zod Schemas for Tavily Tool Parameters
// ============================================================================

export const TavilySearchParamsSchema = z.object({
  query: z.string().min(1).describe('The search query'),
  maxResults: z.number().min(1).max(20).optional().default(5).describe('Maximum number of results to return'),
  searchDepth: z.enum(['basic', 'advanced']).optional().default('basic').describe('Search depth: basic for quick searches, advanced for more comprehensive results'),
  includeAnswer: z.boolean().optional().default(true).describe('Whether to include an AI-generated answer summary'),
});

export const TavilyExtractParamsSchema = z.object({
  url: z.string().url().describe('The URL to extract content from'),
});

export const TavilyCrawlParamsSchema = z.object({
  url: z.string().url().describe('The starting URL to crawl'),
  maxPages: z.number().min(1).max(50).optional().default(10).describe('Maximum number of pages to crawl'),
});

export const TavilyResearchParamsSchema = z.object({
  topic: z.string().min(1).describe('The research topic'),
  depth: z.enum(['shallow', 'medium', 'deep']).optional().default('medium').describe('Research depth'),
});

export type TavilySearchParams = z.infer<typeof TavilySearchParamsSchema>;
export type TavilyExtractParams = z.infer<typeof TavilyExtractParamsSchema>;
export type TavilyCrawlParams = z.infer<typeof TavilyCrawlParamsSchema>;
export type TavilyResearchParams = z.infer<typeof TavilyResearchParamsSchema>;

// ============================================================================
// Helper Functions
// ============================================================================

import type { ToolContext } from './index';

async function getTavilyApiKeyFromContext(context: ToolContext): Promise<string | null> {
  // First try environment variable
  if (process.env.TAVILY_API_KEY) {
    return process.env.TAVILY_API_KEY;
  }

  // Then try to get from user's stored keys via entity
  try {
    const { getUserApiKeyForProvider, decryptApiKey } = await import(
      '@/lib/db/queries/userApiKeys'
    );

    const { getEntityUserId } = await import('@/lib/db/queries/entities');
    const userId = await getEntityUserId(context.entityId);

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

interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilySearchResponse {
  answer?: string;
  results: TavilySearchResult[];
}

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
    name: 'tavilySearch',
    description: 'Search the web using Tavily. Returns relevant web results and optionally an AI-generated answer.',
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
    const parsed = TavilySearchParamsSchema.safeParse(params);
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
      }) as TavilySearchResponse;

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
    name: 'tavilyExtract',
    description: 'Extract clean content from a webpage URL using Tavily.',
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
    const parsed = TavilyExtractParamsSchema.safeParse(params);
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
      }) as { results: Array<{ url: string; raw_content: string }> };

      const result = response.results?.[0];
      if (!result) {
        return {
          success: false,
          error: 'No content extracted from URL',
        };
      }

      return {
        success: true,
        data: {
          url: result.url,
          content: result.raw_content,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Extraction failed',
      };
    }
  },
};

// ============================================================================
// research Tool (combines multiple searches)
// ============================================================================

const researchTool: Tool = {
  schema: {
    name: 'tavilyResearch',
    description: 'Conduct in-depth research on a topic by performing multiple targeted searches.',
    parameters: [
      {
        name: 'topic',
        type: 'string',
        description: 'The research topic',
        required: true,
      },
      {
        name: 'depth',
        type: 'string',
        description: 'Research depth: "shallow", "medium", or "deep"',
        required: false,
        enum: ['shallow', 'medium', 'deep'],
      },
    ],
  },
  handler: async (params, context): Promise<ToolResult> => {
    const parsed = TavilyResearchParamsSchema.safeParse(params);
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
      const { topic, depth } = parsed.data;

      // Determine search configuration based on depth
      const searchConfig = {
        shallow: { queries: 1, maxResults: 5, searchDepth: 'basic' as const },
        medium: { queries: 2, maxResults: 8, searchDepth: 'advanced' as const },
        deep: { queries: 3, maxResults: 10, searchDepth: 'advanced' as const },
      }[depth];

      // Generate related queries based on topic
      const queries = [
        topic,
        `${topic} latest news and updates`,
        `${topic} analysis and insights`,
      ].slice(0, searchConfig.queries);

      // Execute searches in parallel
      const searchPromises = queries.map(async (query) => {
        const response = await callTavilyAPI('search', apiKey, {
          query,
          max_results: searchConfig.maxResults,
          search_depth: searchConfig.searchDepth,
          include_answer: true,
        }) as TavilySearchResponse;
        return { query, response };
      });

      const searchResults = await Promise.all(searchPromises);

      // Compile research summary
      const allResults: Array<{ title: string; url: string; snippet: string; query: string }> = [];
      const answers: string[] = [];

      for (const { query, response } of searchResults) {
        if (response.answer) {
          answers.push(`[${query}]: ${response.answer}`);
        }
        for (const result of response.results) {
          allResults.push({
            title: result.title,
            url: result.url,
            snippet: result.content.substring(0, 300),
            query,
          });
        }
      }

      return {
        success: true,
        data: {
          topic,
          depth,
          summaries: answers,
          sources: allResults,
          totalSources: allResults.length,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Research failed',
      };
    }
  },
};

// ============================================================================
// Registration
// ============================================================================

/**
 * Register all Tavily tools
 */
export function registerTavilyTools(): void {
  registerTool(searchTool);
  registerTool(extractTool);
  registerTool(researchTool);
}

// Export individual tools for testing
export { searchTool, extractTool, researchTool };
