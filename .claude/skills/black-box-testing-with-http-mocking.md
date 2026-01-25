# Black Box Testing with HTTP Mocking (TypeScript)

## Overview

**Black box testing tests behavior, not implementation. Mock the boundaries (HTTP calls), not the tools (libraries).**

When testing code that uses external services, ALWAYS prefer mocking HTTP URLs and responses. This tests your actual integration code while keeping tests fast and deterministic.

## The Mocking Hierarchy

Follow this strict priority order:

### 1. Mock HTTP URLs (ALWAYS PREFERRED)

Mock the actual HTTP endpoints and their responses using tools like `msw` (Mock Service Worker) or `nock`:

```typescript
// ✅ CORRECT: Mock the HTTP boundary with MSW
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

const server = setupServer(
  http.post('https://api.anthropic.com/v1/messages', () => {
    return HttpResponse.json({
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello!' }],
      model: 'claude-3-5-sonnet-latest',
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 }
    });
  })
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test('generates completion', async () => {
  // Test makes actual call to Anthropic SDK
  const response = await request(app)
    .post('/v1/analysis/generate')
    .send({ prompt: 'Hello' });

  expect(response.status).toBe(200);
});
```

```typescript
// ✅ CORRECT: Mock the HTTP boundary with nock
import nock from 'nock';

test('generates completion', async () => {
  nock('https://api.anthropic.com')
    .post('/v1/messages')
    .reply(200, {
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello!' }],
      model: 'claude-3-5-sonnet-latest',
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 }
    });

  // Test makes actual call to Anthropic SDK
  const response = await request(app)
    .post('/v1/analysis/generate')
    .send({ prompt: 'Hello' });

  expect(response.status).toBe(200);
});
```

**Why this is better:**
- Tests real library integration (serialization, error handling, retries)
- Doesn't break when library internals change
- Catches bugs in how you use the library
- Still fast and deterministic

### 2. Mock External Libraries (ONLY IF NECESSARY)

Mock external libraries ONLY when:
- No HTTP calls are made
- HTTP mocking is infeasible or overly complex
- Testing library wrapper code specifically

```typescript
// ⚠️ ACCEPTABLE ONLY IF HTTP MOCKING NOT FEASIBLE
import { jest } from '@jest/globals';

jest.mock('some-external-lib', () => ({
  SomeLibrary: jest.fn().mockImplementation(() => ({
    process: jest.fn().mockResolvedValue('result')
  }))
}));

test('with library mock', async () => {
  // ... test code
});
```

### 3. Mock Our Own Code (NEVER ACCEPTABLE)

```typescript
// ❌ NEVER DO THIS
jest.mock('../services/completion', () => ({
  completeRequest: jest.fn().mockResolvedValue({ text: 'mocked' })
}));

test('endpoint with mocked service', async () => {
  // This doesn't test anything - you're mocking the code under test!
});
```

**Mocking your own code = not testing your own code.**

## Testing Pattern (All Components)

For endpoints, tools, and services - same principle:

```typescript
// Example test file structure
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import request from 'supertest';
import { app } from '../app';

// Setup MSW server
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('CompletionController', () => {
  test('generates completion without tool use', async () => {
    // Mock external HTTP endpoints
    server.use(
      http.get('http://decision-service/api/v1/users/current', () => {
        return HttpResponse.json({ id: 1, email: 'test@example.com' });
      }),
      http.post('https://api.anthropic.com/v1/messages', () => {
        return HttpResponse.json({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Analysis complete.' }],
          model: 'claude-3-5-sonnet-latest',
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 50 }
        });
      })
    );

    // Test through public interface
    const response = await request(app)
      .post('/v1/threads/123/completion')
      .set('Authorization', 'Bearer token')
      .send({ id: 'msg-id', content: 'Analyze this data' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchSnapshot();
  });

  test('handles tool use correctly', async () => {
    // Mock with sequential responses for tool calls
    let callCount = 0;
    server.use(
      http.post('https://api.anthropic.com/v1/messages', () => {
        callCount++;
        if (callCount === 1) {
          // First call: model requests tool use
          return HttpResponse.json({
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            content: [{
              type: 'tool_use',
              id: 'toolu_123',
              name: 'read_recipe',
              input: { recipe_id: 101 }
            }],
            model: 'claude-3-5-sonnet-latest',
            stop_reason: 'tool_use',
            usage: { input_tokens: 50, output_tokens: 30 }
          });
        }
        // Second call: model responds after tool result
        return HttpResponse.json({
          id: 'msg_2',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Based on the recipe...' }],
          model: 'claude-3-5-sonnet-latest',
          stop_reason: 'end_turn',
          usage: { input_tokens: 150, output_tokens: 100 }
        });
      })
    );

    const response = await request(app)
      .post('/v1/threads/123/completion')
      .set('Authorization', 'Bearer token')
      .send({ id: 'msg-id', content: 'Show me recipe 101' });

    expect(response.status).toBe(200);
  });

  test('handles streaming responses', async () => {
    server.use(
      http.post('https://api.anthropic.com/v1/messages', () => {
        // Return SSE stream
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            const events = [
              'event: message_start\ndata: {"type":"message_start"}\n\n',
              'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"Hello"}}\n\n',
              'event: message_stop\ndata: {"type":"message_stop"}\n\n'
            ];
            events.forEach(event => controller.enqueue(encoder.encode(event)));
            controller.close();
          }
        });
        return new HttpResponse(stream, {
          headers: { 'Content-Type': 'text/event-stream' }
        });
      })
    );

    const response = await request(app)
      .post('/v1/threads/123/completion')
      .set('Authorization', 'Bearer token')
      .send({ id: 'msg-id', content: 'Hello' });

    expect(response.status).toBe(200);
  });

  test('handles API errors with fallback', async () => {
    let anthropicCalls = 0;
    server.use(
      http.post('https://api.anthropic.com/v1/messages', () => {
        anthropicCalls++;
        if (anthropicCalls === 1) {
          return HttpResponse.json(
            { error: { type: 'api_error', message: 'Internal error' } },
            { status: 500 }
          );
        }
        return HttpResponse.json({
          id: 'msg_fallback',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Fallback response' }],
          model: 'claude-3-5-sonnet-latest',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 }
        });
      }),
      http.post('https://api.openai.com/v1/chat/completions', () => {
        return HttpResponse.json({
          id: 'chatcmpl-123',
          choices: [{
            message: { role: 'assistant', content: 'OpenAI fallback' },
            finish_reason: 'stop'
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5 }
        });
      })
    );

    const response = await request(app)
      .post('/v1/threads/123/completion')
      .send({ id: 'msg-id', content: 'Hello' });

    expect(response.status).toBe(200);
  });
});
```

**Mock:** External HTTP URLs only
**Don't Mock:** Anthropic/OpenAI SDKs, your business logic, database layer, Express/Fastify test client

## Reference Examples

### Example: Testing with Request Payload Assertions

```typescript
test('sends correct payload to Anthropic', async () => {
  let capturedRequest: any;

  server.use(
    http.post('https://api.anthropic.com/v1/messages', async ({ request }) => {
      capturedRequest = await request.json();
      return HttpResponse.json({
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Response' }],
        model: 'claude-3-5-sonnet-latest',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 }
      });
    })
  );

  await request(app)
    .post('/v1/completion')
    .send({ prompt: 'Hello' });

  // Assert on the actual payload sent to the API
  expect(capturedRequest).toMatchSnapshot();
  expect(capturedRequest.model).toBe('claude-3-5-sonnet-latest');
  expect(capturedRequest.messages).toHaveLength(1);
});
```

### Example: Testing Cancellation (Acceptable Library Mock)

```typescript
// The ONLY acceptable library mock is for testing control flow like cancellation
test('cancels in-flight request', async () => {
  const abortController = new AbortController();
  const mockTask = {
    done: jest.fn().mockReturnValue(false),
    cancel: jest.fn()
  };

  // Mock only the task management, not the external service
  inflightRuns.set('thread-123', mockTask);

  const response = await request(app)
    .post('/v1/threads/thread-123/stop-completion');

  expect(response.status).toBe(200);
  expect(mockTask.cancel).toHaveBeenCalled();
});
```

## Common Rationalizations (DON'T BELIEVE THESE)

| Excuse | Reality |
|--------|---------|
| "External dependency we don't control" | Exactly why you SHOULD test how you integrate with it |
| "Fast to write with library mocking" | 5 extra minutes now saves hours debugging integration bugs |
| "Common pattern everyone uses" | Common doesn't mean correct. This codebase uses HTTP mocking |
| "The test works with library mocks" | It works but doesn't test your actual integration code |
| "Too complex to mock HTTP" | MSW/nock make it simple: `http.post(url).reply(200, data)` |
| "No HTTP calls in this code" | THEN library mocking might be acceptable (check first) |
| "TypeScript types make mocking harder" | MSW has excellent TypeScript support with type inference |
| "I need to test error scenarios" | MSW supports `.networkError()` and status codes perfectly |

## Red Flags - STOP and Use HTTP Mocking

- `jest.mock('@anthropic-ai/sdk')`
- `jest.mock('openai')`
- `jest.mock('axios')` or `jest.mock('node-fetch')`
- `jest.mock('../services/yourOwnCode')`
- `vi.mock(...)` on external SDKs (Vitest)
- `sinon.stub(anthropic, 'messages')`
- "This will be quicker if I just mock the library"
- "I've already written the library mock"

**All of these mean: Delete the mock. Use HTTP mocking instead.**

## When Library Mocking IS Acceptable

- Testing code that wraps/abstracts an external library
- Library doesn't make HTTP calls (e.g., date-fns, uuid, lodash)
- Testing error handling of library-specific exceptions
- Testing control flow (like task cancellation)
- HTTP mocking genuinely not feasible (document why in comment)

Even then, prefer HTTP mocking if possible.

## Quick Reference

| Component Type | Mock This | Don't Mock This |
|----------------|-----------|-----------------|
| Express/Fastify endpoints | External HTTP URLs | @anthropic-ai/sdk, openai, axios, your code |
| Tools/Utilities | External HTTP URLs | External libraries (unless no HTTP), your code |
| Services | External HTTP URLs | External libraries (unless no HTTP), your code |
| Database layer | External HTTP URLs (if any) | Your models, queries, ORM (Prisma, TypeORM) |

## Setup Patterns

### MSW (Mock Service Worker) - Recommended

```typescript
// test/setup.ts
import { beforeAll, afterEach, afterAll } from 'vitest'; // or jest
import { setupServer } from 'msw/node';

export const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

```typescript
// test/handlers.ts - reusable handlers
import { http, HttpResponse } from 'msw';

export const handlers = {
  anthropicSuccess: http.post('https://api.anthropic.com/v1/messages', () => {
    return HttpResponse.json({
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello!' }],
      model: 'claude-3-5-sonnet-latest',
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 }
    });
  }),

  anthropicError: http.post('https://api.anthropic.com/v1/messages', () => {
    return HttpResponse.json(
      { error: { type: 'rate_limit_error', message: 'Rate limited' } },
      { status: 429 }
    );
  }),

  openaiSuccess: http.post('https://api.openai.com/v1/chat/completions', () => {
    return HttpResponse.json({
      id: 'chatcmpl-123',
      choices: [{
        message: { role: 'assistant', content: 'Hello!' },
        finish_reason: 'stop'
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5 }
    });
  })
};
```

### Nock Alternative

```typescript
// test/setup.ts
import nock from 'nock';

beforeEach(() => {
  nock.cleanAll();
});

afterAll(() => {
  nock.restore();
});

// In tests
test('calls Anthropic API', async () => {
  const scope = nock('https://api.anthropic.com')
    .post('/v1/messages')
    .reply(200, {
      id: 'msg_123',
      content: [{ type: 'text', text: 'Hello!' }]
    });

  await myFunction();

  expect(scope.isDone()).toBe(true);
});
```

## Quick Checklist

- [ ] Mock HTTP URLs (not libraries) using MSW or nock
- [ ] Test through public interface (HTTP endpoints, exported functions)
- [ ] Assert on observable behavior (response, side effects)
- [ ] Capture and assert on outgoing request payloads when relevant
- [ ] Use snapshot tests for complex response structures

## The Bottom Line

**HTTP mocking tests your real integration. Library mocking tests your mock.**

If your code calls Anthropic, OpenAI, or any HTTP service:
1. Mock the HTTP URL
2. Use the real SDK/library
3. Test the real integration

No exceptions unless HTTP mocking is genuinely not feasible (and it almost always is).
