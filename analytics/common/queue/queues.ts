/**
 * BullMQ queue instances for Hyperliquid analytics
 */

import { Queue, JobsOptions } from 'bullmq';
import { getQueueConnection } from './connection';
import {
  QUEUE_NAMES,
  TraderStatsJob,
  AssetStatsJob,
  TradeExecutionJob,
} from './job-types';
import { queueConfigs } from './queue-config';
import logger from '../logger';

// Queue instances (lazy initialized)
let traderStatsQueue: Queue<TraderStatsJob> | null = null;
let assetStatsQueue: Queue<AssetStatsJob> | null = null;
let tradeExecutionQueue: Queue<TradeExecutionJob> | null = null;

function createQueue<T>(name: string): Queue<T> {
  return new Queue<T>(name, {
    connection: getQueueConnection(),
    defaultJobOptions: queueConfigs[name as keyof typeof queueConfigs]?.jobOptions,
  });
}

export function getTraderStatsQueue(): Queue<TraderStatsJob> {
  if (!traderStatsQueue) {
    traderStatsQueue = createQueue<TraderStatsJob>(QUEUE_NAMES.TRADER_STATS);
  }
  return traderStatsQueue;
}

export function getAssetStatsQueue(): Queue<AssetStatsJob> {
  if (!assetStatsQueue) {
    assetStatsQueue = createQueue<AssetStatsJob>(QUEUE_NAMES.ASSET_STATS);
  }
  return assetStatsQueue;
}

export function getTradeExecutionQueue(): Queue<TradeExecutionJob> {
  if (!tradeExecutionQueue) {
    tradeExecutionQueue = createQueue<TradeExecutionJob>(QUEUE_NAMES.TRADE_EXECUTION);
  }
  return tradeExecutionQueue;
}

/**
 * Wait for a queue to drain (all jobs processed).
 */
export async function waitForQueueDrain<T>(
  queue: Queue<T>,
  pollIntervalMs = 5000,
  maxWaitMs = 3600000,
): Promise<void> {
  const startTime = Date.now();
  const queueName = queue.name;

  while (Date.now() - startTime < maxWaitMs) {
    const [waiting, active, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getDelayedCount(),
    ]);

    const backlog = waiting + delayed;

    if (backlog === 0 && active === 0) {
      logger.info(`[Queue] ${queueName} drained successfully`);
      return;
    }

    logger.info(
      `[Queue] ${queueName} status: backlog=${backlog} (waiting=${waiting}, delayed=${delayed}), active=${active}`,
    );
    await new Promise(r => setTimeout(r, pollIntervalMs));
  }

  throw new Error(`Queue ${queueName} did not drain within ${maxWaitMs / 1000}s timeout`);
}

/**
 * Enqueue a job if it's not already in the queue (waiting/active/delayed).
 */
export async function enqueueIfNotExists<T>(
  queue: Queue<T>,
  jobName: string,
  jobId: string,
  data: T,
  options?: JobsOptions,
): Promise<boolean> {
  try {
    const existingJob = await queue.getJob(jobId);
    if (existingJob) {
      const state = await existingJob.getState();
      if (['active', 'waiting', 'delayed', 'waiting-children', 'prioritized'].includes(state)) {
        return false;
      }
    }

    await (queue as any).add(jobName, data, { priority: 10, ...options, jobId });
    return true;
  } catch (error) {
    logger.warn(`[Queue] Failed to enqueue job ${jobId}: ${error}`);
    return false;
  }
}

export async function closeAllQueues(): Promise<void> {
  const queuesToClose = [
    traderStatsQueue,
    assetStatsQueue,
    tradeExecutionQueue,
  ].filter(q => q !== null);

  await Promise.all(queuesToClose.map(q => q!.close()));

  traderStatsQueue = null;
  assetStatsQueue = null;
  tradeExecutionQueue = null;

  logger.info('[Queue] All queues closed');
}
