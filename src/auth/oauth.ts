import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { URL } from 'node:url';
import type { UpworkConfig, UpworkTokens } from '../common/types.js';
import { TokenStore } from './token-store.js';

const UPWORK_AUTH_URL = 'https://www.upwork.com/ab/account-security/oauth2/authorize';
const UPWORK_TOKEN_URL = 'https://www.upwork.com/api/v3/oauth2/token';
const AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * OAuth 2.0 Authorization Code Grant with localhost callback.
 * Implements the flow manually (no node-upwork-oauth2 dependency)
 * per the spec's fallback strategy.
 */
export class OAuthFlow {
  private config: UpworkConfig;
  private tokenStore: TokenStore;

  constructor(config: UpworkConfig, tokenStore: TokenStore) {
    this.config = config;
    this.tokenStore = tokenStore;
  }

  /**
   * Run the full interactive OAuth authorization flow.
   * 1. Start local HTTP server on redirect URI port
   * 2. Open browser to Upwork auth URL
   * 3. Wait for callback with auth code
   * 4. Exchange code for tokens
   * 5. Save tokens and shut down server
   */
  async authorize(): Promise<UpworkTokens> {
    const redirectUrl = new URL(this.config.redirectUri);
    const port = parseInt(redirectUrl.port, 10) || 9876;
    const state = randomBytes(32).toString('hex');

    return new Promise<UpworkTokens>((resolve, reject) => {
      let settled = false;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        fn();
      };

      const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        try {
          const url = new URL(req.url ?? '/', `http://localhost:${port}`);

          if (url.pathname === '/callback') {
            const code = url.searchParams.get('code');
            const error = url.searchParams.get('error');
            const returnedState = url.searchParams.get('state');

            // F2: Verify CSRF state parameter
            if (returnedState !== state) {
              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end('<html><body><h1>Error</h1><p>Invalid state parameter. Possible CSRF attack.</p></body></html>');
              server.close();
              settle(() => reject(new Error('OAuth state mismatch — possible CSRF')));
              return;
            }

            if (error) {
              // F1: HTML-encode error to prevent XSS
              const safeError = escapeHtml(error);
              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end(`<html><body><h1>Authorization Failed</h1><p>${safeError}</p><p>You can close this window.</p></body></html>`);
              server.close();
              settle(() => reject(new Error(`OAuth error: ${error}`)));
              return;
            }

            if (!code) {
              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end('<html><body><h1>Error</h1><p>No authorization code received.</p></body></html>');
              server.close();
              settle(() => reject(new Error('No authorization code received')));
              return;
            }

            // Exchange code for tokens
            const tokens = await this.exchangeCode(code);
            await this.tokenStore.save(tokens);

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body><h1>Authorization Successful!</h1><p>You can close this window and return to your terminal.</p></body></html>');
            server.close();
            settle(() => resolve(tokens));
          } else {
            res.writeHead(404);
            res.end('Not found');
          }
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>Error</h1><p>Token exchange failed. Check your terminal for details.</p></body></html>');
          server.close();
          settle(() => reject(err));
        }
      });

      // F13: Timeout if user never completes the flow
      const timeout = setTimeout(() => {
        server.close();
        settle(() => reject(new Error(`Authorization timed out after ${AUTH_TIMEOUT_MS / 1000}s. Run the auth command again.`)));
      }, AUTH_TIMEOUT_MS);

      server.listen(port, () => {
        const authUrl = this.buildAuthUrl(state);
        console.error(`\nOpen this URL in your browser to authorize:\n\n  ${authUrl}\n`);
        console.error(`Waiting for authorization callback on port ${port}... (timeout: 5 minutes)`);

        // Try to open browser automatically
        this.openBrowser(authUrl).catch(() => {
          // Silently fail — user can open URL manually
        });
      });

      server.on('error', (err) => {
        settle(() => reject(new Error(`Failed to start auth server on port ${port}: ${err.message}`)));
      });
    });
  }

  /**
   * Refresh an expired access token using the refresh token.
   */
  async refreshToken(refreshToken: string): Promise<UpworkTokens> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    const response = await fetch(UPWORK_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Token refresh failed (${response.status}): ${errorBody}`);
    }

    // F15: Validate response body structure
    const data = await response.json() as Record<string, unknown>;
    const tokens = parseTokenResponse(data);

    await this.tokenStore.save(tokens);
    return tokens;
  }

  private async exchangeCode(code: string): Promise<UpworkTokens> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: this.config.redirectUri,
    });

    const response = await fetch(UPWORK_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Token exchange failed (${response.status}): ${errorBody}`);
    }

    // F15: Validate response body structure
    const data = await response.json() as Record<string, unknown>;
    return parseTokenResponse(data);
  }

  private buildAuthUrl(state: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      state,
    });
    return `${UPWORK_AUTH_URL}?${params.toString()}`;
  }

  // F3: Use execFile with argument array instead of exec with string interpolation
  private async openBrowser(url: string): Promise<void> {
    const { execFile } = await import('node:child_process');
    const platform = process.platform;

    return new Promise<void>((resolve, reject) => {
      if (platform === 'win32') {
        execFile('cmd', ['/c', 'start', '', url], (err) => {
          if (err) reject(err);
          else resolve();
        });
      } else if (platform === 'darwin') {
        execFile('open', [url], (err) => {
          if (err) reject(err);
          else resolve();
        });
      } else {
        execFile('xdg-open', [url], (err) => {
          if (err) reject(err);
          else resolve();
        });
      }
    });
  }
}

/** HTML-encode a string to prevent XSS in HTML responses */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Validate and parse a token response from Upwork */
function parseTokenResponse(data: Record<string, unknown>): UpworkTokens {
  const accessToken = data.access_token;
  const refreshToken = data.refresh_token;
  const tokenType = data.token_type;
  const expiresIn = data.expires_in;

  if (typeof accessToken !== 'string' || !accessToken) {
    throw new Error('Token response missing access_token');
  }
  if (typeof refreshToken !== 'string' || !refreshToken) {
    throw new Error('Token response missing refresh_token');
  }
  if (typeof expiresIn !== 'number' || expiresIn <= 0) {
    throw new Error('Token response missing or invalid expires_in');
  }

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: typeof tokenType === 'string' ? tokenType : 'bearer',
    expires_in: expiresIn,
    expires_at: Date.now() + expiresIn * 1000,
  };
}
