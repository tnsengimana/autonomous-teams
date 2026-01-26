# Plan 15: Add LM Studio Provider

## Overview

Add LM Studio as an LLM provider for local development. LM Studio is an OpenAI-compatible local server that runs models on your machine.

## Configuration

- **Base URL**: `LMSTUDIO_BASE_URL` environment variable, defaults to `http://localhost:1234/v1`
- **API Key**: None required (local server)
- **Default Model**: `mistralai/ministral-3-14b-reasoning`

## Changes

### 1. Install dependency

```bash
npm install @ai-sdk/openai-compatible
```

### 2. Update `src/lib/types.ts`

Add `'lmstudio'` to the `LLMProvider` type:

```typescript
export type LLMProvider = 'openai' | 'anthropic' | 'google' | 'lmstudio';
```

### 3. Update `src/lib/agents/llm.ts`

#### Import

```typescript
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
```

#### DEFAULT_MODEL

```typescript
const DEFAULT_MODEL = {
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-20250514",
  google: "gemini-3-flash-preview",
  lmstudio: "mistralai/ministral-3-14b-reasoning",
} as const;
```

#### Provider creation function

```typescript
function createLMStudioProvider() {
  const baseURL = process.env.LMSTUDIO_BASE_URL ?? 'http://localhost:1234/v1';
  return createOpenAICompatible({
    name: 'lmstudio',
    baseURL,
  });
}
```

#### Update getApiKey()

Return `null` for lmstudio (no API key needed):

```typescript
if (provider === "lmstudio") {
  return null;
}
```

#### Update isProviderAvailable()

Check if LM Studio base URL is configured:

```typescript
if (provider === "lmstudio") {
  return process.env.LMSTUDIO_BASE_URL !== undefined;
}
```

#### Add lmstudio branches

Add handling in:
- `streamLLMResponse()`
- `streamLLMResponseWithTools()`
- `generateLLMResponse()`
- `generateLLMObject()`

Pattern:
```typescript
if (provider === "lmstudio") {
  const lmstudio = createLMStudioProvider();
  // ... same logic as other providers using lmstudio(model)
}
```

#### Update getDefaultProvider()

Add lmstudio as lowest priority (local dev tool):

```typescript
export async function getDefaultProvider(
  userId?: string,
): Promise<LLMProvider | undefined> {
  if (await isProviderAvailable("google", userId)) return "google";
  if (await isProviderAvailable("openai", userId)) return "openai";
  if (await isProviderAvailable("anthropic", userId)) return "anthropic";
  if (await isProviderAvailable("lmstudio", userId)) return "lmstudio";
  return undefined;
}
```

## Testing

1. Set `LMSTUDIO_BASE_URL=http://localhost:1234/v1` in `.env.local`
2. Start LM Studio and load a model
3. Start the local server in LM Studio's Local Server tab
4. Test with the app by selecting lmstudio as provider
