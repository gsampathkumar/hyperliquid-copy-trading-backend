/**
 * Trade Execution Worker
 *
 * Processes hl-trade-execution jobs:
 * - Receives monitor match events from action relay
 * - Opens/closes paper copy trade positions
 * - Updates copy trade state and audit log
 *
 * Placeholder — will be fully implemented in Step 5.
 */

import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { QUEUE_NAMES, TradeExecutionJob } from '../common/queue/job-types';
import { queueConfigs } from '../common/queue/queue-config';
import logger from '../common/logger';

async function processTradeExecution(job: Job<TradeExecutionJob>): Promise<void> {
  const { actionId, eventType, traderAddress, assetName } = job.data;
  logger.info(`[TradeExecution] Processing ${eventType} for action ${actionId}: ${traderAddress} ${assetName}`);

  // TODO: Step 5 implementation
  // 1. Look up action config (sizing, leverage cap, limits)
  // 2. Validate constraints (capital, positions, allowed/blocked assets)
  // 3. Open or close paper position
  // 4. Update copy trade state
  // 5. Log to action audit log

  logger.info(`[TradeExecution] Completed ${eventType} for action ${actionId}`);
}

export function createTradeExecutionWorker(connection: Redis): Worker {
  const config = queueConfigs[QUEUE_NAMES.TRADE_EXECUTION];

  const worker = new Worker<TradeExecutionJob>(
    QUEUE_NAMES.TRADE_EXECUTION,
    processTradeExecution,
    {
      connection,
      concurrency: config.concurrency,
    }
  );

  worker.on('completed', (job) => {
    logger.debug(`[TradeExecution] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`[TradeExecution] Job ${job?.id} failed: ${err.message}`);
  });

  return worker;
}
