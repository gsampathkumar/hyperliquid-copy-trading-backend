/**
 * Queue names and types for Hyperliquid analytics workers
 */

export const QUEUE_NAMES = {
  TRADER_STATS: 'hl-trader-stats',
  ASSET_STATS: 'hl-asset-stats',
  TRADE_EXECUTION: 'hl-trade-execution',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
