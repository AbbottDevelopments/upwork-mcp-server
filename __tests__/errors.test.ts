import { describe, it, expect } from 'vitest';
import { UpworkMcpError, authRequired, tokenExpired, rateLimited, apiError, invalidInput } from '../src/common/errors.js';

describe('UpworkMcpError', () => {
  it('creates structured error response', () => {
    const err = new UpworkMcpError('API_ERROR', 'test error', true, { statusCode: 500 });
    const structured = err.toStructured();

    expect(structured.error).toBe('API_ERROR');
    expect(structured.message).toBe('test error');
    expect(structured.retryable).toBe(true);
    expect(structured.details).toEqual({ statusCode: 500 });
  });

  it('creates MCP error response', () => {
    const err = authRequired();
    const mcp = err.toMcpError();

    expect(mcp.isError).toBe(true);
    expect(mcp.content).toHaveLength(1);
    expect(mcp.content[0].type).toBe('text');

    const parsed = JSON.parse(mcp.content[0].text);
    expect(parsed.error).toBe('AUTH_REQUIRED');
    expect(parsed.retryable).toBe(false);
  });

  it('factory functions produce correct categories', () => {
    expect(authRequired().category).toBe('AUTH_REQUIRED');
    expect(tokenExpired().category).toBe('TOKEN_EXPIRED');
    expect(rateLimited().category).toBe('RATE_LIMITED');
    expect(apiError(500, 'fail').category).toBe('API_ERROR');
    expect(invalidInput('bad').category).toBe('INVALID_INPUT');
  });

  it('apiError marks 5xx as retryable', () => {
    expect(apiError(500, '').retryable).toBe(true);
    expect(apiError(503, '').retryable).toBe(true);
    expect(apiError(400, '').retryable).toBe(false);
    expect(apiError(404, '').retryable).toBe(false);
  });
});
