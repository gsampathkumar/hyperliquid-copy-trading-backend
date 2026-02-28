/**
 * Queue configuration - local copy for API project
 * Keep in sync with analytics/common/queue/queue-config.ts
 */

import { QUEUE_NAMES, QueueName } from './queue-constants';

export interface QueueConfig {
  concurrency: number;
}

export const queueConfigs: Record<QueueName, QueueConfig> = {
  [QUEUE_NAMES.TRADER_STATS]: {
    concurrency: 5,
  },
  [QUEUE_NAMES.ASSET_STATS]: {
    concurrency: 5,
  },
  [QUEUE_NAMES.TRADE_EXECUTION]: {
    concurrency: 10,
  },
};
