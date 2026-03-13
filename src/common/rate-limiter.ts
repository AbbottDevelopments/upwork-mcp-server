import type { RateLimitState } from './types.js';

/**
 * Fixed-window rate limiter enforcing Upwork API limits:
 * - 10 req/sec window
 * - 300 req/min sustained
 * - 40,000 req/day cap
 *
 * Per-HTTP-request counting (not per-tool-call).
 */
export class RateLimiter {
  private state: RateLimitState;

  private readonly BURST_LIMIT = 10;
  private readonly MINUTE_LIMIT = 300;
  private readonly DAILY_LIMIT = 40_000;
  private readonly BURST_WINDOW_MS = 1000; // 1 second

  constructor() {
    const now = Date.now();
    this.state = {
      burstTokens: this.BURST_LIMIT,
      lastBurstRefill: now,
      minuteCount: 0,
      minuteWindowStart: now,
      dailyCount: 0,
      dailyWindowStart: now,
    };
  }

  /**
   * Wait until a request can be made, then consume a token.
   * Returns immediately if capacity is available.
   */
  async acquire(): Promise<void> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      this.refill();
      const waitMs = this.getWaitTime();
      if (waitMs === 0) {
        this.consume();
        return;
      }
      await this.sleep(waitMs);
    }
  }

  private refill(): void {
    const now = Date.now();

    // F12: Reset burst window (fixed window, not token bucket)
    // Each 1-second window allows BURST_LIMIT requests
    const elapsed = now - this.state.lastBurstRefill;
    if (elapsed >= this.BURST_WINDOW_MS) {
      this.state.burstTokens = this.BURST_LIMIT;
      this.state.lastBurstRefill = now;
    }

    // Reset minute window
    if (now - this.state.minuteWindowStart >= 60_000) {
      this.state.minuteCount = 0;
      this.state.minuteWindowStart = now;
    }

    // Reset daily window
    if (now - this.state.dailyWindowStart >= 86_400_000) {
      this.state.dailyCount = 0;
      this.state.dailyWindowStart = now;
    }
  }

  private getWaitTime(): number {
    const now = Date.now();

    if (this.state.dailyCount >= this.DAILY_LIMIT) {
      // F18: Guard against negative wait times from clock drift
      return Math.max(1, this.state.dailyWindowStart + 86_400_000 - now);
    }
    if (this.state.minuteCount >= this.MINUTE_LIMIT) {
      return Math.max(1, this.state.minuteWindowStart + 60_000 - now);
    }
    if (this.state.burstTokens <= 0) {
      return Math.max(1, this.state.lastBurstRefill + this.BURST_WINDOW_MS - now);
    }
    return 0;
  }

  private consume(): void {
    this.state.burstTokens--;
    this.state.minuteCount++;
    this.state.dailyCount++;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, Math.max(1, ms)));
  }
}
