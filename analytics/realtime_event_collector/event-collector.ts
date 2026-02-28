/**
 * Hyperliquid Real-Time Event Collector
 *
 * Maintains WebSocket subscriptions to Hyperliquid for:
 * - userFills on tracked traders (high-priority)
 * - allMids for price updates
 *
 * Publishes normalized events to Redis channel `hyperliquid:events`
 * for consumption by the monitor relay service.
 *
 * Placeholder — will be fully implemented in Step 4.
 */

import '../common/env';
import logger from '../common/logger';
import { getStorage } from '../common/storage';
import { getQueueConnection, testRedisConnection, closeQueueConnection } from '../common/queue/connection';

async function main() {
  logger.info('[EventCollector] Starting Hyperliquid event collector...');

  // Test Redis
  const redisOk = await testRedisConnection();
  if (!redisOk) {
    logger.error('[EventCollector] Redis connection failed. Exiting.');
    process.exit(1);
  }

  // Connect MongoDB
  const storage = getStorage();
  await storage.connect();
  logger.info('[EventCollector] MongoDB connected');

  // TODO: Step 4 implementation
  // 1. Initialize Hyperliquid SDK SubscriptionClient
  // 2. Load tracked traders from DB
  // 3. Subscribe to userFills for each tracked trader
  // 4. Subscribe to allMids for price updates
  // 5. Normalize events and publish to Redis channel `hyperliquid:events`
  // 6. Enqueue trader-stats and asset-stats jobs as needed

  logger.info('[EventCollector] Event collector running. Press Ctrl+C to stop.');

  // Graceful shutdown
  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      process.exit(1);
    }
    isShuttingDown = true;
    logger.info(`[EventCollector] Received ${signal}, shutting down...`);

    await closeQueueConnection();
    await storage.disconnect();

    logger.info('[EventCollector] Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error(`[EventCollector] Fatal error: ${err}`);
  process.exit(1);
});
