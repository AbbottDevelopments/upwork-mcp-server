/**
 * Shared TypeScript types for the Upwork MCP server.
 */

export interface UpworkTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  expires_at: number; // Unix timestamp (ms) when access_token expires
}

export interface UpworkConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface RateLimitState {
  /** Tokens available for burst (per-second) */
  burstTokens: number;
  /** Last burst refill timestamp */
  lastBurstRefill: number;
  /** Requests made in current minute window */
  minuteCount: number;
  /** Minute window start timestamp */
  minuteWindowStart: number;
  /** Requests made today */
  dailyCount: number;
  /** Day window start timestamp */
  dailyWindowStart: number;
}

export type ErrorCategory =
  | 'AUTH_REQUIRED'
  | 'TOKEN_EXPIRED'
  | 'RATE_LIMITED'
  | 'API_ERROR'
  | 'NETWORK_ERROR'
  | 'INVALID_INPUT'
  | 'PARTIAL_RESPONSE';

export interface StructuredError {
  error: ErrorCategory;
  message: string;
  retryable: boolean;
  details?: unknown;
}
