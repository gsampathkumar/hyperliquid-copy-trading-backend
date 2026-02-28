/**
 * Worker Process Entry Point
 *
 * Starts all BullMQ workers for real-time processing.
 * Run this as a separate process from the event collector.
 *
 * Usage:
 *   ts-node workers/index.ts
 *
 * Or via npm script:
 *   npm run workers
 */

import '../common/env'; // Load environment from root .env
import logger from '../common/logger';
import { getStorage } from '../common/storage';
import { createRedisConnection, testRedisConnection, closeQueueConnection } from '../common/queue/connection';
import { createTraderStatsWorker } from './trader-stats.worker';
import { createAssetStatsWorker } from './asset-stats.worker';
import { createTradeExecutionWorker } from './trade-execution.worker';
import { QUEUE_NAMES } from '../common/queue/job-types';
import { WORKER_CONCURRENCY } from '../common/queue/queue-config';

async function main() {
  logger.info('[Workers] Starting Hyperliquid BullMQ workers...');

  // Test Redis connectivity first
  const redisOk = await testRedisConnection();
  if (!redisOk) {
    logger.error('[Workers] Redis connection failed. Exiting.');
    process.exit(1);
  }

  // Connect Storage singleton (shared by all workers)
  const storage = getStorage();
  await storage.connect();
  logger.info('[Workers] MongoDB connected');

  // Create separate Redis connections for each worker (recommended by BullMQ)
  const connections = {
    traderStats: createRedisConnection(),
    assetStats: createRedisConnection(),
    tradeExecution: createRedisConnection(),
  };

  // Create workers
  const workers = [
    createTraderStatsWorker(connections.traderStats),
    createAssetStatsWorker(connections.assetStats),
    createTradeExecutionWorker(connections.tradeExecution),
  ];

  logger.info('[Workers] Workers started:');
  logger.info(`  - ${QUEUE_NAMES.TRADER_STATS}: concurrency ${WORKER_CONCURRENCY[QUEUE_NAMES.TRADER_STATS]}`);
  logger.info(`  - ${QUEUE_NAMES.ASSET_STATS}: concurrency ${WORKER_CONCURRENCY[QUEUE_NAMES.ASSET_STATS]}`);
  logger.info(`  - ${QUEUE_NAMES.TRADE_EXECUTION}: concurrency ${WORKER_CONCURRENCY[QUEUE_NAMES.TRADE_EXECUTION]}`);

  // Graceful shutdown handler
  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      logger.info(`[Workers] Force exit requested`);
      process.exit(1);
    }
    isShuttingDown = true;
    logger.info(`[Workers] Received ${signal}, shutting down gracefully...`);
    logger.info(`[Workers] (Press Ctrl+C again to force exit)`);

    const SHUTDOWN_TIMEOUT_MS = 10000;
    const closePromise = Promise.all(workers.map((w) => w.close()));
    const timeoutPromise = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('Shutdown timeout')), SHUTDOWN_TIMEOUT_MS)
    );

    try {
      await Promise.race([closePromise, timeoutPromise]);
      logger.info('[Workers] All workers closed gracefully');
    } catch (err) {
      logger.warn(`[Workers] Shutdown timeout, forcing close...`);
    }

    // Close Redis connections
    await closeQueueConnection();
    await Promise.all(Object.values(connections).map((c) => c.quit()));
    logger.info('[Workers] Redis connections closed');

    // Close MongoDB connection
    await storage.disconnect();
    logger.info('[Workers] MongoDB connection closed');

    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  logger.info('[Workers] Workers running. Press Ctrl+C to stop.');
}

// Run
main().catch((err) => {
  logger.error(`[Workers] Fatal error: ${err}`);
  process.exit(1);
});
