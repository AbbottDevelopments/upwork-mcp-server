import type { ErrorCategory, StructuredError } from './types.js';

export class UpworkMcpError extends Error {
  public readonly category: ErrorCategory;
  public readonly retryable: boolean;
  public readonly details?: unknown;

  constructor(category: ErrorCategory, message: string, retryable: boolean, details?: unknown) {
    super(message);
    this.name = 'UpworkMcpError';
    this.category = category;
    this.retryable = retryable;
    this.details = details;
  }

  toStructured(): StructuredError {
    return {
      error: this.category,
      message: this.message,
      retryable: this.retryable,
      ...(this.details !== undefined && { details: this.details }),
    };
  }

  toMcpError(): { content: Array<{ type: 'text'; text: string }>; isError: true } {
    return {
      content: [{ type: 'text', text: JSON.stringify(this.toStructured()) }],
      isError: true,
    };
  }
}

export function authRequired(): UpworkMcpError {
  return new UpworkMcpError(
    'AUTH_REQUIRED',
    'No token found. Run `npx upwork-mcp-server auth` to authorize.',
    false
  );
}

export function tokenExpired(): UpworkMcpError {
  return new UpworkMcpError(
    'TOKEN_EXPIRED',
    'Refresh token expired. Run `npx upwork-mcp-server auth` to re-authorize.',
    false
  );
}

export function rateLimited(retryAfterMs?: number): UpworkMcpError {
  return new UpworkMcpError(
    'RATE_LIMITED',
    'Rate limit exceeded. Request will be retried automatically.',
    true,
    retryAfterMs ? { retryAfterMs } : undefined
  );
}

export function apiError(statusCode: number, body: string): UpworkMcpError {
  const retryable = statusCode >= 500;
  return new UpworkMcpError(
    'API_ERROR',
    `Upwork API returned ${statusCode}: ${body}`,
    retryable,
    { statusCode }
  );
}

export function networkError(cause: string): UpworkMcpError {
  return new UpworkMcpError(
    'NETWORK_ERROR',
    `Network error: ${cause}`,
    true
  );
}

export function invalidInput(details: string): UpworkMcpError {
  return new UpworkMcpError(
    'INVALID_INPUT',
    `Invalid input: ${details}`,
    false,
    { details }
  );
}
