/**
 * Standalone Hyperliquid API Client for analytics workers.
 * Uses @nktkas/hyperliquid SDK directly (no NestJS dependency).
 */

import * as hl from '@nktkas/hyperliquid';
import WebSocket from 'ws';
import logger from './logger';

// Rate limit: 1200 weight/min = 20 weight/sec
// Simple token bucket rate limiter
class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per ms

  constructor(maxPerMinute: number) {
    this.maxTokens = maxPerMinute;
    this.tokens = maxPerMinute;
    this.lastRefill = Date.now();
    this.refillRate = maxPerMinute / 60000;
  }

  async acquire(weight: number): Promise<void> {
    while (true) {
      this.refill();
      if (this.tokens >= weight) {
        this.tokens -= weight;
        return;
      }
      // Wait for enough tokens to accumulate
      const waitMs = Math.ceil((weight - this.tokens) / this.refillRate);
      await new Promise(resolve => setTimeout(resolve, waitMs + 10));
    }
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

export class HyperliquidClient {
  private infoClient: hl.InfoClient;
  private _subscriptionClient: hl.SubscriptionClient | null = null;
  private rateLimiter: RateLimiter;

  constructor(budgetPerMinute: number = 1100) {
    // Use 1100 of 1200 budget — leave headroom
    this.rateLimiter = new RateLimiter(budgetPerMinute);

    const transport = new hl.HttpTransport();
    this.infoClient = new hl.InfoClient({ transport });

    // WebSocket transport created lazily — only needed for subscriptions
  }

  private getOrCreateSubscriptionClient(): hl.SubscriptionClient {
    if (!this._subscriptionClient) {
      const wsTransport = new hl.WebSocketTransport({
        reconnect: { WebSocket: WebSocket as any },
      });
      this._subscriptionClient = new hl.SubscriptionClient({ transport: wsTransport });
    }
    return this._subscriptionClient;
  }

  // === Info API methods (rate-limited) ===

  async getAllMids(): Promise<Record<string, string>> {
    await this.rateLimiter.acquire(2);
    return this.infoClient.allMids();
  }

  async getMetaAndAssetCtxs(): Promise<any> {
    await this.rateLimiter.acquire(20);
    return this.infoClient.metaAndAssetCtxs();
  }

  async getMeta(): Promise<any> {
    await this.rateLimiter.acquire(20);
    return this.infoClient.meta();
  }

  async getClearinghouseState(user: `0x${string}`): Promise<any> {
    await this.rateLimiter.acquire(2);
    return this.infoClient.clearinghouseState({ user });
  }

  async getUserFills(user: `0x${string}`): Promise<any[]> {
    await this.rateLimiter.acquire(20);
    return this.infoClient.userFills({ user });
  }

  async getUserFillsByTime(user: `0x${string}`, startTime: number, endTime?: number): Promise<any[]> {
    await this.rateLimiter.acquire(25); // 20 + estimated response weight
    return this.infoClient.userFillsByTime({
      user,
      startTime,
      ...(endTime !== undefined ? { endTime } : {}),
    });
  }

  async getUserFunding(user: `0x${string}`, startTime: number, endTime?: number): Promise<any[]> {
    await this.rateLimiter.acquire(25);
    return this.infoClient.userFunding({
      user,
      startTime,
      ...(endTime !== undefined ? { endTime } : {}),
    });
  }

  async getPortfolio(user: `0x${string}`): Promise<any> {
    await this.rateLimiter.acquire(20);
    return this.infoClient.portfolio({ user });
  }

  async getFundingHistory(coin: string, startTime: number, endTime?: number): Promise<any[]> {
    await this.rateLimiter.acquire(25);
    return this.infoClient.fundingHistory({
      coin,
      startTime,
      ...(endTime !== undefined ? { endTime } : {}),
    });
  }

  async getCandleSnapshot(
    coin: string,
    interval: '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '8h' | '12h' | '1d' | '3d' | '1w' | '1M',
    startTime: number,
    endTime: number,
  ): Promise<any[]> {
    await this.rateLimiter.acquire(25);
    return this.infoClient.candleSnapshot({ coin, interval, startTime, endTime });
  }

  async getL2Book(coin: string): Promise<any> {
    await this.rateLimiter.acquire(2);
    return this.infoClient.l2Book({ coin });
  }

  // === Paginated helpers ===

  /**
   * Paginate userFillsByTime, fetching up to maxFills (default 10,000).
   * Returns fills sorted oldest to newest + metadata about whether the API cap was hit.
   */
  async paginateUserFills(
    user: `0x${string}`,
    maxFills: number = 10000,
    onProgress?: (fetched: number) => void,
  ): Promise<{ fills: any[]; hitApiCap: boolean }> {
    const allFills: any[] = [];
    let startTime = 0; // Epoch — get everything
    const pageSize = 2000;
    let hitApiCap = false;

    while (allFills.length < maxFills) {
      const fills = await this.getUserFillsByTime(user, startTime);

      if (!fills || fills.length === 0) break;

      allFills.push(...fills);
      onProgress?.(allFills.length);

      if (fills.length < pageSize) break; // Last page — got everything

      // Next page starts after the last fill's timestamp
      const lastFill = fills[fills.length - 1];
      startTime = lastFill.time + 1;
    }

    // If we fetched maxFills and the last page was full, we likely hit the API cap
    if (allFills.length >= maxFills) {
      hitApiCap = true;
    }

    return { fills: allFills, hitApiCap };
  }

  /**
   * Paginate userFunding, fetching all available.
   */
  async paginateUserFunding(user: `0x${string}`): Promise<any[]> {
    const allFunding: any[] = [];
    let startTime = 0;

    while (true) {
      const funding = await this.getUserFunding(user, startTime);

      if (!funding || funding.length === 0) break;

      allFunding.push(...funding);

      if (funding.length < 500) break; // Last page

      const lastEntry = funding[funding.length - 1];
      startTime = lastEntry.time + 1;
    }

    return allFunding;
  }

  // === Subscription API ===

  getInfoClient(): hl.InfoClient {
    return this.infoClient;
  }

  getSubscriptionClient(): hl.SubscriptionClient {
    return this.getOrCreateSubscriptionClient();
  }
}

// Singleton instance
let clientInstance: HyperliquidClient | null = null;

export function getHyperliquidClient(budgetPerMinute?: number): HyperliquidClient {
  if (!clientInstance) {
    clientInstance = new HyperliquidClient(budgetPerMinute);
  }
  return clientInstance;
}
