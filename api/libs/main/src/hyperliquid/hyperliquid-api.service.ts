import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { LoggerService } from '@hyperliquid-api/main/shared/modules/util/logger.service';
import { RateLimiterService } from '@hyperliquid-api/main/shared/modules/rate-limiter/rate-limiter.service';
import { HttpTransport, InfoClient, WebSocketTransport, SubscriptionClient } from '@nktkas/hyperliquid';

/**
 * Wrapper around @nktkas/hyperliquid SDK
 *
 * Provides rate-limited access to Hyperliquid's:
 * - InfoClient: read-only queries (positions, fills, funding, leaderboard, assets)
 * - SubscriptionClient: WebSocket subscriptions (allMids, trades, l2Book, userFills)
 * - ExchangeClient: authenticated trading (Phase 2, stubbed)
 */
@Injectable()
export class HyperliquidApiService implements OnModuleInit, OnModuleDestroy {
  private infoClient: InfoClient;
  private subscriptionClient: SubscriptionClient;
  private httpTransport: HttpTransport;
  private wsTransport: WebSocketTransport;

  constructor(
    private readonly logger: LoggerService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  async onModuleInit() {
    this.httpTransport = new HttpTransport();
    this.infoClient = new InfoClient({ transport: this.httpTransport });

    this.wsTransport = new WebSocketTransport();
    this.subscriptionClient = new SubscriptionClient({ transport: this.wsTransport });

    this.logger.info('HyperliquidApiService:: Initialized InfoClient + SubscriptionClient');
  }

  async onModuleDestroy() {
    this.logger.info('HyperliquidApiService:: Shutting down');
  }

  // ============================================================
  // Info API — Read-only queries
  // ============================================================

  /**
   * Get mid prices for all assets
   */
  async getAllMids(): Promise<Record<string, string>> {
    await this.rateLimiter.infoApi.acquire();
    return this.infoClient.allMids();
  }

  /**
   * Get metadata and asset contexts (prices, OI, funding, volume)
   */
  async getMetaAndAssetCtxs(): Promise<any> {
    await this.rateLimiter.infoApi.acquire();
    return this.infoClient.metaAndAssetCtxs();
  }

  /**
   * Get perpetual metadata (asset names, szDecimals, etc.)
   */
  async getMeta(): Promise<any> {
    await this.rateLimiter.infoApi.acquire();
    return this.infoClient.meta();
  }

  /**
   * Get a user's open orders
   */
  async getOpenOrders(user: string): Promise<any[]> {
    await this.rateLimiter.infoApi.acquire();
    return this.infoClient.openOrders({ user });
  }

  /**
   * Get a user's clearinghouse state (positions, margin, account value)
   */
  async getClearinghouseState(user: string): Promise<any> {
    await this.rateLimiter.infoApi.acquire();
    return this.infoClient.clearinghouseState({ user });
  }

  /**
   * Get a user's fills (trade history)
   */
  async getUserFills(user: string): Promise<any[]> {
    await this.rateLimiter.infoApi.acquire();
    return this.infoClient.userFills({ user });
  }

  /**
   * Get a user's fills by time range
   */
  async getUserFillsByTime(user: string, startTime: number, endTime?: number): Promise<any[]> {
    await this.rateLimiter.infoApi.acquire();
    return this.infoClient.userFillsByTime({
      user,
      startTime,
      ...(endTime !== undefined ? { endTime } : {}),
    });
  }

  /**
   * Get a user's funding payments
   */
  async getUserFunding(user: string, startTime: number, endTime?: number): Promise<any[]> {
    await this.rateLimiter.infoApi.acquire();
    return this.infoClient.userFunding({
      user,
      startTime,
      ...(endTime !== undefined ? { endTime } : {}),
    });
  }

  /**
   * Get funding history for an asset
   */
  async getFundingHistory(coin: string, startTime: number, endTime?: number): Promise<any[]> {
    await this.rateLimiter.infoApi.acquire();
    return this.infoClient.fundingHistory({
      coin,
      startTime,
      ...(endTime !== undefined ? { endTime } : {}),
    });
  }

  /**
   * Get L2 order book snapshot
   */
  async getL2Book(coin: string): Promise<any> {
    await this.rateLimiter.infoApi.acquire();
    return this.infoClient.l2Book({ coin });
  }

  /**
   * Get candle (OHLCV) data
   */
  async getCandleSnapshot(coin: string, interval: '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '8h' | '12h' | '1d' | '3d' | '1w' | '1M', startTime: number, endTime: number): Promise<any[]> {
    await this.rateLimiter.infoApi.acquire();
    return this.infoClient.candleSnapshot({
      coin,
      interval,
      startTime,
      endTime,
    });
  }

  // ============================================================
  // Subscription API — WebSocket real-time streams
  // ============================================================

  /**
   * Subscribe to all mid prices
   */
  subscribeAllMids(callback: (data: any) => void): void {
    this.subscriptionClient.allMids(callback);
  }

  /**
   * Subscribe to L2 book updates for a coin
   */
  subscribeL2Book(coin: string, callback: (data: any) => void): void {
    this.subscriptionClient.l2Book({ coin }, callback);
  }

  /**
   * Subscribe to trades for a coin
   */
  subscribeTrades(coin: string, callback: (data: any) => void): void {
    this.subscriptionClient.trades({ coin }, callback);
  }

  /**
   * Subscribe to a user's fills
   */
  subscribeUserFills(user: string, callback: (data: any) => void): void {
    this.subscriptionClient.userFills({ user }, callback);
  }

  // ============================================================
  // Exchange API — Authenticated trading (Phase 2 stubs)
  // ============================================================

  /**
   * Place an order (Phase 2)
   * @throws Not implemented yet
   */
  async placeOrder(_params: any): Promise<any> {
    throw new Error('HyperliquidApiService::placeOrder: Not implemented - Phase 2');
  }

  /**
   * Cancel an order (Phase 2)
   * @throws Not implemented yet
   */
  async cancelOrder(_params: any): Promise<any> {
    throw new Error('HyperliquidApiService::cancelOrder: Not implemented - Phase 2');
  }

  // ============================================================
  // Accessors
  // ============================================================

  getInfoClient(): InfoClient {
    return this.infoClient;
  }

  getSubscriptionClient(): SubscriptionClient {
    return this.subscriptionClient;
  }
}
