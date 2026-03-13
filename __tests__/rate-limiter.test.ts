import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../src/common/rate-limiter.js';

describe('RateLimiter', () => {
  it('allows immediate burst of requests up to limit', async () => {
    const limiter = new RateLimiter();
    const start = Date.now();

    // Should acquire 10 tokens instantly (burst limit)
    for (let i = 0; i < 10; i++) {
      await limiter.acquire();
    }

    const elapsed = Date.now() - start;
    // Should complete very quickly (well under 500ms)
    expect(elapsed).toBeLessThan(500);
  });

  it('delays after burst limit exhausted', async () => {
    const limiter = new RateLimiter();

    // Exhaust burst
    for (let i = 0; i < 10; i++) {
      await limiter.acquire();
    }

    const start = Date.now();
    // 11th request should wait for refill
    await limiter.acquire();
    const elapsed = Date.now() - start;

    // Should have waited ~1 second for burst refill
    expect(elapsed).toBeGreaterThanOrEqual(900);
  });
});
