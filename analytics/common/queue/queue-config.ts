/**
 * BullMQ queue configuration - job options and concurrency
 *
 * NOTE: No retries configured - catch-up jobs handle failures.
 * Real-time pipeline is best-effort; batch scripts ensure consistency.
 */

import { DefaultJobOptions } from 'bullmq';
import { QUEUE_NAMES, QueueName } from './job-types';

export const WORKER_INSTANCES = Math.max(1, parseInt(process.env.WORKER_INSTANCES || '1', 10));

export const defaultJobOptions: DefaultJobOptions = {
  attempts: 1,
  removeOnComplete: {
    age: 3600,
    count: 1000,
  },
  removeOnFail: {
    age: 86400,
  },
};

export const queueConfigs: Record<
  QueueName,
  {
    jobOptions: DefaultJobOptions;
    concurrency: number;
    limiter?: { max: number; duration: number };
  }
> = {
  [QUEUE_NAMES.TRADER_STATS]: {
    jobOptions: defaultJobOptions,
    concurrency: Math.max(1, Math.floor(12 / WORKER_INSTANCES)),
    limiter: {
      max: 12, // Conservative - Hyperliquid rate limits are tighter than Polymarket
      duration: 1000,
    },
  },
  [QUEUE_NAMES.ASSET_STATS]: {
    jobOptions: defaultJobOptions,
    concurrency: 5,
    limiter: {
      max: 10,
      duration: 1000,
    },
  },
  [QUEUE_NAMES.TRADE_EXECUTION]: {
    jobOptions: defaultJobOptions,
    concurrency: 10,
  },
};

export const WORKER_CONCURRENCY = {
  [QUEUE_NAMES.TRADER_STATS]:
    queueConfigs[QUEUE_NAMES.TRADER_STATS].concurrency,
  [QUEUE_NAMES.ASSET_STATS]:
    queueConfigs[QUEUE_NAMES.ASSET_STATS].concurrency,
  [QUEUE_NAMES.TRADE_EXECUTION]:
    queueConfigs[QUEUE_NAMES.TRADE_EXECUTION].concurrency,
} as const;
