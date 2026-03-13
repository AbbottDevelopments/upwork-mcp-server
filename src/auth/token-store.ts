import { readFile, writeFile, mkdir, chmod, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { UpworkTokens } from '../common/types.js';

const CONFIG_DIR = join(homedir(), '.upwork-mcp');
const TOKEN_FILE = join(CONFIG_DIR, 'token.json');

// F9: Zod schema for validating token JSON from disk
const TokensSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  token_type: z.string(),
  expires_in: z.number().positive(),
  expires_at: z.number().positive(),
});

/**
 * Persist and retrieve OAuth tokens from ~/.upwork-mcp/token.json
 * File permissions: 0600 (owner read/write only)
 * Directory permissions: 0700
 */
export class TokenStore {
  private cached: UpworkTokens | null = null;

  async load(): Promise<UpworkTokens | null> {
    if (this.cached) return this.cached;

    if (!existsSync(TOKEN_FILE)) return null;

    try {
      const raw = await readFile(TOKEN_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      const tokens = TokensSchema.parse(parsed);
      this.cached = tokens;
      return tokens;
    } catch {
      return null;
    }
  }

  async save(tokens: UpworkTokens): Promise<void> {
    // F8: Always call mkdir with recursive — no TOCTOU race
    await mkdir(CONFIG_DIR, { recursive: true });
    try {
      await chmod(CONFIG_DIR, 0o700);
    } catch {
      // chmod may not work on Windows — documented in README
    }

    await writeFile(TOKEN_FILE, JSON.stringify(tokens, null, 2), 'utf-8');
    try {
      await chmod(TOKEN_FILE, 0o600);
    } catch {
      // chmod may not work on Windows
    }

    this.cached = tokens;
  }

  // F6: Delete the file instead of writing empty string
  async clear(): Promise<void> {
    this.cached = null;
    if (existsSync(TOKEN_FILE)) {
      await unlink(TOKEN_FILE);
    }
  }

  isExpired(tokens: UpworkTokens): boolean {
    // 60-second buffer before actual expiry
    return Date.now() >= tokens.expires_at - 60_000;
  }

  clearCache(): void {
    this.cached = null;
  }
}
