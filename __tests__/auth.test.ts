import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TokenStore } from '../src/auth/token-store.js';
import type { UpworkTokens } from '../src/common/types.js';

// Mock fs operations
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  chmod: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
}));

describe('TokenStore', () => {
  let store: TokenStore;

  beforeEach(() => {
    store = new TokenStore();
    vi.clearAllMocks();
  });

  it('returns null when no token file exists', async () => {
    const tokens = await store.load();
    expect(tokens).toBeNull();
  });

  it('correctly identifies expired tokens', () => {
    const expired: UpworkTokens = {
      access_token: 'test',
      refresh_token: 'test',
      token_type: 'bearer',
      expires_in: 86400,
      expires_at: Date.now() - 1000, // Already expired
    };
    expect(store.isExpired(expired)).toBe(true);
  });

  it('correctly identifies valid tokens', () => {
    const valid: UpworkTokens = {
      access_token: 'test',
      refresh_token: 'test',
      token_type: 'bearer',
      expires_in: 86400,
      expires_at: Date.now() + 3600_000, // 1 hour from now
    };
    expect(store.isExpired(valid)).toBe(false);
  });

  it('identifies tokens expiring within 60s buffer as expired', () => {
    const almostExpired: UpworkTokens = {
      access_token: 'test',
      refresh_token: 'test',
      token_type: 'bearer',
      expires_in: 86400,
      expires_at: Date.now() + 30_000, // 30 seconds from now (within 60s buffer)
    };
    expect(store.isExpired(almostExpired)).toBe(true);
  });
});
