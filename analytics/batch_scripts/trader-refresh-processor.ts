/**
 * Trader Refresh Processor (Batch Script)
 *
 * Finds traders whose scheduled refresh time has passed and enqueues
 * them for stats refresh. Uses the adaptive refresh scheduling:
 *
 * - Each trader has a `nextRefreshAt` computed from their fill rate
 * - Active traders (high fill rate) refresh more frequently
 * - Inactive traders refresh once per day (max interval)
 * - Also catches traders that have never been processed
 *
 * Run via cron every 5-10 minutes, or manually:
 *   npx ts-node batch_scripts/trader-refresh-processor.ts
 *   npx ts-node batch_scripts/trader-refresh-processor.ts --continuous
 */

import '../common/env';
import logger from '../common/logger';
import { getStorage, Storage } from '../common/storage';
import { withLockAndReport } from '../common/job-reporter';
import {
  getTraderStatsQueue,
  enqueueIfNotExists,
  waitForQueueDrain,
} from '../common/queue/queues';
import { TraderStatsJob } from '../common/queue/job-types';

const DEFAULT_LIMIT = 500; // Max traders to enqueue per run

export interface TraderRefreshProcessorOptions {
  limit?: number;
}

export class TraderRefreshProcessor {
  private storage: Storage;

  constructor() {
    this.storage = getStorage();
  }

  async run(options: TraderRefreshProcessorOptions = {}): Promise<{
    scheduledEnqueued: number;
    scheduledSkipped: number;
    neverProcessedEnqueued: number;
    neverProcessedSkipped: number;
  }> {
    const limit = options.limit || DEFAULT_LIMIT;

    logger.info(`[TraderRefresh] Starting run (limit=${limit})...`);

    let scheduledEnqueued = 0;
    let scheduledSkipped = 0;
    let neverProcessedEnqueued = 0;
    let neverProcessedSkipped = 0;

    try {
      await this.storage.connect();

      const queue = getTraderStatsQueue();
      const now = new Date();

      // Phase 1: Traders whose nextRefreshAt has passed
      const tradersNeedingRefresh = await this.storage.getTradersNeedingScheduledRefresh(limit);
      logger.info(`[TraderRefresh] Phase 1: ${tradersNeedingRefresh.length} traders past nextRefreshAt`);

      for (const trader of tradersNeedingRefresh) {
        const address = trader.address.toLowerCase();
        const jobData: TraderStatsJob = {
          traderAddress: address,
          reason: 'scheduled',
          enqueuedAt: now,
        };

        const added = await enqueueIfNotExists(queue, 'compute', `trader_${address}`, jobData);
        if (added) {
          scheduledEnqueued++;
        } else {
          scheduledSkipped++;
        }

        if ((scheduledEnqueued + scheduledSkipped) % 100 === 0) {
          logger.info(`[TraderRefresh] Phase 1 progress: ${scheduledEnqueued} enqueued, ${scheduledSkipped} skipped`);
        }
      }

      logger.info(`[TraderRefresh] Phase 1 complete: ${scheduledEnqueued} enqueued, ${scheduledSkipped} already in queue`);

      // Phase 2: Traders that have never been processed (no traderProcessedAt)
      const neverProcessed = await this.storage.traders().find({
        traderProcessedAt: { $exists: false },
      })
        .sort({ _id: 1 })
        .limit(limit)
        .toArray();

      logger.info(`[TraderRefresh] Phase 2: ${neverProcessed.length} never-processed traders`);

      for (const trader of neverProcessed) {
        const address = trader.address.toLowerCase();
        const jobData: TraderStatsJob = {
          traderAddress: address,
          reason: 'discovery',
          enqueuedAt: now,
        };

        const added = await enqueueIfNotExists(queue, 'compute', `trader_${address}`, jobData);
        if (added) {
          neverProcessedEnqueued++;
        } else {
          neverProcessedSkipped++;
        }
      }

      logger.info(
        `[TraderRefresh] Complete: scheduled=${scheduledEnqueued}/${scheduledSkipped}, discovery=${neverProcessedEnqueued}/${neverProcessedSkipped}`,
      );
    } finally {
      await this.storage.disconnect();
    }

    return { scheduledEnqueued, scheduledSkipped, neverProcessedEnqueued, neverProcessedSkipped };
  }
}

// Run if executed directly
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Trader Refresh Processor

Finds traders whose scheduled refresh time has passed and enqueues
them to the trader-stats worker queue for processing.

Phase 1: Traders with nextRefreshAt <= now (adaptive schedule)
Phase 2: Traders never processed (no traderProcessedAt)

Usage:
  ts-node batch_scripts/trader-refresh-processor.ts [options]

Options:
  --limit=N          Max traders per batch (default: ${DEFAULT_LIMIT})
  --continuous       Keep running until all work is complete
  --help, -h         Show this help message

Examples:
  ts-node batch_scripts/trader-refresh-processor.ts
  ts-node batch_scripts/trader-refresh-processor.ts --limit=1000
  ts-node batch_scripts/trader-refresh-processor.ts --continuous
`);
    process.exit(0);
  }

  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : undefined;
  const continuous = args.includes('--continuous');

  const runProcessor = async () => {
    const processor = new TraderRefreshProcessor();

    if (continuous) {
      logger.info('[TraderRefresh] Running in continuous mode...');

      while (true) {
        const result = await processor.run({ limit });
        const totalEnqueued = result.scheduledEnqueued + result.neverProcessedEnqueued;

        if (totalEnqueued === 0) {
          logger.info('[TraderRefresh] No more work to do. Exiting continuous mode.');
          break;
        }

        logger.info(`[TraderRefresh] Waiting for queue to drain (${totalEnqueued} jobs)...`);
        const queue = getTraderStatsQueue();
        await waitForQueueDrain(queue);
        logger.info('[TraderRefresh] Queue drained. Checking for more work...');
      }

      return {
        scheduledEnqueued: 0,
        scheduledSkipped: 0,
        neverProcessedEnqueued: 0,
        neverProcessedSkipped: 0,
      };
    } else {
      return processor.run({ limit });
    }
  };

  withLockAndReport('trader-refresh-processor', runProcessor)
    .then(() => {
      process.exit(0);
    })
    .catch(error => {
      logger.error(`[TraderRefresh] Fatal error: ${error}`);
      process.exit(1);
    });
}
