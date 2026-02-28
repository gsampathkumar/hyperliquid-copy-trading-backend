/**
 * Asset Refresh Processor (Batch Script)
 *
 * Enqueues asset stats refresh jobs on a schedule.
 * Unlike trader refresh (per-entity scheduling), assets use bulk refresh —
 * a single metaAndAssetCtxs call updates all ~200 assets at once.
 *
 * Two job types:
 * 1. Price refresh — updates prices, OI, volume, funding rate (every 5 min)
 * 2. Funding snapshot — stores hourly funding rate history (every 1 hour)
 *
 * Run via cron every 5 minutes:
 *   npx ts-node batch_scripts/asset-refresh-processor.ts
 *
 * Or run the funding snapshot hourly:
 *   npx ts-node batch_scripts/asset-refresh-processor.ts --funding-snapshot
 */

import '../common/env';
import logger from '../common/logger';
import { getStorage } from '../common/storage';
import { withLockAndReport } from '../common/job-reporter';
import {
  getAssetStatsQueue,
  enqueueIfNotExists,
} from '../common/queue/queues';
import { AssetStatsJob } from '../common/queue/job-types';
import { ASSET_REFRESH_CONFIG } from '../common/config';

export class AssetRefreshProcessor {
  async run(options: { fundingSnapshot?: boolean } = {}): Promise<{
    priceEnqueued: number;
    fundingEnqueued: number;
  }> {
    const storage = getStorage();
    let priceEnqueued = 0;
    let fundingEnqueued = 0;

    try {
      await storage.connect();

      const queue = getAssetStatsQueue();
      const now = new Date();

      // Check when assets were last updated
      const lastUpdated = await storage.assets()
        .findOne({}, { sort: { lastUpdatedAt: -1 }, projection: { lastUpdatedAt: 1 } });

      const lastUpdateTime = lastUpdated?.lastUpdatedAt?.getTime() || 0;
      const timeSinceUpdate = Date.now() - lastUpdateTime;

      // Enqueue price refresh if enough time has passed
      if (timeSinceUpdate >= ASSET_REFRESH_CONFIG.PRICE_INTERVAL_MS) {
        const jobData: AssetStatsJob = {
          reason: 'scheduled',
          enqueuedAt: now,
        };

        const added = await enqueueIfNotExists(queue, 'refresh-all', 'asset_price_refresh', jobData);
        if (added) {
          priceEnqueued = 1;
          logger.info(`[AssetRefresh] Enqueued price refresh (last update ${Math.round(timeSinceUpdate / 1000)}s ago)`);
        } else {
          logger.info('[AssetRefresh] Price refresh already in queue');
        }
      } else {
        const secsUntilNext = Math.round((ASSET_REFRESH_CONFIG.PRICE_INTERVAL_MS - timeSinceUpdate) / 1000);
        logger.info(`[AssetRefresh] Price data fresh (next refresh in ${secsUntilNext}s)`);
      }

      // Enqueue funding snapshot if requested
      if (options.fundingSnapshot) {
        // Check last funding snapshot
        const lastSnapshot = await storage.fundingHistory()
          .findOne({}, { sort: { timestamp: -1 }, projection: { timestamp: 1 } });

        const lastSnapshotTime = lastSnapshot?.timestamp?.getTime() || 0;
        const timeSinceSnapshot = Date.now() - lastSnapshotTime;

        if (timeSinceSnapshot >= ASSET_REFRESH_CONFIG.FUNDING_SNAPSHOT_INTERVAL_MS) {
          const jobData: AssetStatsJob = {
            reason: 'funding-snapshot',
            enqueuedAt: now,
          };

          const added = await enqueueIfNotExists(queue, 'funding-snapshot', 'asset_funding_snapshot', jobData);
          if (added) {
            fundingEnqueued = 1;
            logger.info(`[AssetRefresh] Enqueued funding snapshot (last snapshot ${Math.round(timeSinceSnapshot / 1000)}s ago)`);
          }
        } else {
          const minsUntilNext = Math.round((ASSET_REFRESH_CONFIG.FUNDING_SNAPSHOT_INTERVAL_MS - timeSinceSnapshot) / 60000);
          logger.info(`[AssetRefresh] Funding snapshot fresh (next in ${minsUntilNext}min)`);
        }
      }

      logger.info(`[AssetRefresh] Complete: price=${priceEnqueued}, funding=${fundingEnqueued}`);
    } finally {
      await storage.disconnect();
    }

    return { priceEnqueued, fundingEnqueued };
  }
}

// Run if executed directly
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Asset Refresh Processor

Enqueues asset stats refresh jobs. All ~200 assets are updated in a
single bulk API call (metaAndAssetCtxs).

Usage:
  ts-node batch_scripts/asset-refresh-processor.ts [options]

Options:
  --funding-snapshot   Also enqueue funding rate snapshot (run hourly)
  --help, -h           Show this help message

Cron examples:
  # Price refresh every 5 minutes
  */5 * * * * ts-node batch_scripts/asset-refresh-processor.ts

  # Funding snapshot every hour (on the hour)
  0 * * * * ts-node batch_scripts/asset-refresh-processor.ts --funding-snapshot
`);
    process.exit(0);
  }

  const fundingSnapshot = args.includes('--funding-snapshot');

  withLockAndReport('asset-refresh-processor', async () => {
    const processor = new AssetRefreshProcessor();
    return processor.run({ fundingSnapshot });
  })
    .then(() => {
      process.exit(0);
    })
    .catch(error => {
      logger.error(`[AssetRefresh] Fatal error: ${error}`);
      process.exit(1);
    });
}
