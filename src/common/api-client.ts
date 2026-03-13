import type { UpworkConfig } from './types.js';
import { TokenStore } from '../auth/token-store.js';
import { OAuthFlow } from '../auth/oauth.js';
import { RateLimiter } from './rate-limiter.js';
import { UpworkMcpError, authRequired, tokenExpired, apiError, networkError } from './errors.js';

const GRAPHQL_URL = 'https://api.upwork.com/graphql';
const REST_BASE = 'https://api.upwork.com';
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;

interface GraphQLResponse<T = unknown> {
  data?: T;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
}

/**
 * Centralized HTTP client for Upwork API.
 * Handles auth headers, token refresh on 401, rate limiting, and retry with exponential backoff.
 */
export class ApiClient {
  private tokenStore: TokenStore;
  private oauthFlow: OAuthFlow;
  private rateLimiter: RateLimiter;

  constructor(config: UpworkConfig, tokenStore: TokenStore) {
    this.tokenStore = tokenStore;
    this.oauthFlow = new OAuthFlow(config, tokenStore);
    this.rateLimiter = new RateLimiter();
  }

  /**
   * Execute a GraphQL query/mutation against the Upwork API.
   */
  async graphql<T = unknown>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<T> {
    const body = JSON.stringify({ query, variables });
    const response = await this.request(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    const result = (await response.json()) as GraphQLResponse<T>;

    if (result.errors && result.errors.length > 0) {
      if (result.data) {
        // Partial response — return data but log warnings
        console.error('[upwork-mcp] GraphQL partial response, errors:', JSON.stringify(result.errors));
        return result.data;
      }
      throw apiError(200, result.errors.map((e) => e.message).join('; '));
    }

    if (!result.data) {
      throw apiError(200, 'GraphQL response missing data');
    }

    return result.data;
  }

  /**
   * Execute a REST API call against the Upwork API.
   */
  async rest<T = unknown>(
    path: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {}
  ): Promise<T> {
    const url = `${REST_BASE}${path}`;
    const response = await this.request(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body,
    });

    return (await response.json()) as T;
  }

  /**
   * Get the OAuthFlow instance for running the interactive auth flow.
   */
  getOAuthFlow(): OAuthFlow {
    return this.oauthFlow;
  }

  /**
   * Core request method with auth, rate limiting, refresh, and retry.
   */
  private async request(
    url: string,
    init: { method: string; headers?: Record<string, string>; body?: string }
  ): Promise<Response> {
    let lastError: Error | null = null;
    let refreshAttempted = false;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      // Rate limit
      await this.rateLimiter.acquire();

      // F5/F16: Always load fresh from store (don't mutate cached objects)
      const tokens = await this.tokenStore.load();
      if (!tokens) throw authRequired();

      // Check if token is expired and proactively refresh
      let accessToken = tokens.access_token;
      if (this.tokenStore.isExpired(tokens)) {
        if (refreshAttempted) throw tokenExpired();
        try {
          refreshAttempted = true;
          this.tokenStore.clearCache();
          const refreshed = await this.oauthFlow.refreshToken(tokens.refresh_token);
          accessToken = refreshed.access_token;
        } catch {
          throw tokenExpired();
        }
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        ...init.headers,
      };

      try {
        const response = await fetch(url, {
          method: init.method,
          headers,
          body: init.body,
          signal: AbortSignal.timeout(30_000), // 30s timeout
        });

        // F4: Handle 401 — try refresh once, produce clear TOKEN_EXPIRED on any subsequent 401
        if (response.status === 401) {
          if (refreshAttempted) throw tokenExpired();
          try {
            refreshAttempted = true;
            this.tokenStore.clearCache();
            const currentTokens = await this.tokenStore.load();
            if (!currentTokens) throw authRequired();
            await this.oauthFlow.refreshToken(currentTokens.refresh_token);
            continue; // Retry with new token
          } catch (refreshErr) {
            if (refreshErr instanceof UpworkMcpError) throw refreshErr;
            throw tokenExpired();
          }
        }

        // F11: Handle 429 — rate limited by server, handle NaN in Retry-After
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          let waitMs = BASE_BACKOFF_MS * Math.pow(2, attempt);
          if (retryAfter) {
            const parsed = parseInt(retryAfter, 10);
            if (!isNaN(parsed) && parsed > 0) {
              waitMs = parsed * 1000;
            }
          }
          console.error(`[upwork-mcp] Rate limited (429). Retrying in ${waitMs}ms...`);
          await this.sleep(waitMs + Math.random() * 500); // jitter
          continue;
        }

        // Handle server errors — retry with backoff
        if (response.status >= 500) {
          const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt) + Math.random() * 500;
          console.error(`[upwork-mcp] Server error (${response.status}). Retrying in ${Math.round(backoff)}ms...`);
          lastError = apiError(response.status, await response.text());
          await this.sleep(backoff);
          continue;
        }

        // Handle client errors (non-401, non-429)
        if (!response.ok) {
          const body = await response.text();
          throw apiError(response.status, body);
        }

        return response;
      } catch (err) {
        // F10: Use instanceof instead of name check
        if (err instanceof UpworkMcpError) throw err;

        if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
          lastError = networkError(`Request timed out after 30s`);
        } else if (err instanceof TypeError) {
          // fetch throws TypeError for network failures
          lastError = networkError(err.message);
        } else {
          throw err;
        }

        if (attempt < MAX_RETRIES - 1) {
          const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt) + Math.random() * 500;
          console.error(`[upwork-mcp] Network error. Retrying in ${Math.round(backoff)}ms...`);
          await this.sleep(backoff);
        }
      }
    }

    throw lastError ?? networkError('Max retries exceeded');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
