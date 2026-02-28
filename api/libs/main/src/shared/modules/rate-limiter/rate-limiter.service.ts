import { Injectable } from '@nestjs/common';

/**
 * Token Bucket Rate Limiter for Hyperliquid API Calls
 * Ensures we stay within rate limits while maximizing throughput
 *
 * Hyperliquid rate limits (weight-based):
 * - Info API: 1200 weight/min = 20 weight/s
 * - Exchange API: 100 req/min = ~1.7 req/s
 *
 * Endpoint weights: allMids=2, clearinghouseState=2, l2Book=2,
 * meta/metaAndAssetCtxs/openOrders/userFills=20, userFillsByTime/userFunding/fundingHistory/candleSnapshot=25
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

  async acquire(weight: number = 1): Promise<void> {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        this._refillTokens();

        if (this.tokens >= weight) {
          this.tokens -= weight;
          resolve();
        } else {
          const waitTime = (weight - this.tokens) / this.refillRate * 1000;
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
  // Info API: 1200 weight/min = 20 weight/s. Use 70% = 14 weight/s.
  // maxTokens must be >= max single request weight (25 for userFillsByTime/userFunding)
  readonly infoApi = new HyperliquidRateLimiter('hl-info-api', 25, 14);

  // Exchange API: 1.7 req/s x 70% = ~1.2 req/s (conservative for trading)
  readonly exchangeApi = new HyperliquidRateLimiter('hl-exchange-api', 2, 1.2);
}
