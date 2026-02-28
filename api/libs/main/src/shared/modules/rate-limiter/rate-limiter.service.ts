import { Injectable } from '@nestjs/common';

/**
 * Token Bucket Rate Limiter for Hyperliquid API Calls
 * Ensures we stay within rate limits while maximizing throughput
 *
 * Hyperliquid rate limits:
 * - Info API: 1200 req/min = 20 req/s
 * - Exchange API: 100 req/min = ~1.7 req/s
 *
 * Strategy: Use 70% of published limits for safety margin.
 */
export class HyperliquidRateLimiter {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number; // tokens per second
  private lastRefill: number;
  private readonly apiName: string;

  constructor(apiName: string, maxTokens: number, refillRate: number) {
    this.apiName = apiName;
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  private _refillTokens(): void {
    const now = Date.now();
    const timePassed = (now - this.lastRefill) / 1000;
    const tokensToAdd = timePassed * this.refillRate;

    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  async acquire(): Promise<void> {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        this._refillTokens();

        if (this.tokens >= 1) {
          this.tokens -= 1;
          resolve();
        } else {
          const waitTime = (1 - this.tokens) / this.refillRate * 1000;
          setTimeout(tryAcquire, Math.max(10, waitTime));
        }
      };

      tryAcquire();
    });
  }

  getStatus(): { tokens: number; maxTokens: number; refillRate: number } {
    this._refillTokens();
    return {
      tokens: this.tokens,
      maxTokens: this.maxTokens,
      refillRate: this.refillRate,
    };
  }
}

@Injectable()
export class RateLimiterService {
  // Info API: 20 req/s x 70% = 14 req/s
  readonly infoApi = new HyperliquidRateLimiter('hl-info-api', 14, 14);

  // Exchange API: 1.7 req/s x 70% = ~1.2 req/s (conservative for trading)
  readonly exchangeApi = new HyperliquidRateLimiter('hl-exchange-api', 2, 1.2);
}
