/**
 * Job payload types for BullMQ queues
 *
 * NOTE: Date fields are serialized to ISO strings when stored in Redis.
 * Workers should use parseJobDate() to convert them back to Date objects.
 */

type SerializedDate = Date | string;

// hl-trader-stats queue - triggered by event collector or catch-up batch
export interface TraderStatsJob {
  traderAddress: string;
  reason: 'trade' | 'catch-up' | 'discovery' | 'manual' | 'scheduled';
  enqueuedAt: SerializedDate;
}

// hl-asset-stats queue - triggered by scheduled refresh
export interface AssetStatsJob {
  assetName?: string; // If omitted, refresh all assets
  reason: 'scheduled' | 'catch-up' | 'manual' | 'funding-snapshot';
  enqueuedAt: SerializedDate;
}

// hl-trade-execution queue - triggered by action relay on monitor match
export interface TradeExecutionJob {
  actionId: string;
  monitorId: string;
  eventType: 'open' | 'close' | 'update';
  traderAddress: string;
  assetName: string;
  direction: 'long' | 'short';
  size: string;
  price: string;
  leverage: string;
  enqueuedAt: SerializedDate;
}

/**
 * Helper to parse a Date field that may be serialized as a string
 */
export function parseJobDate(value: SerializedDate): Date {
  return value instanceof Date ? value : new Date(value);
}

// Queue names as constants
export const QUEUE_NAMES = {
  TRADER_STATS: 'hl-trader-stats',
  ASSET_STATS: 'hl-asset-stats',
  TRADE_EXECUTION: 'hl-trade-execution',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
