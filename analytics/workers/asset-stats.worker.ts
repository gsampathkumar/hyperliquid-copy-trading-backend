/**
 * Asset Stats Worker
 *
 * Processes hl-asset-stats jobs:
 * - Fetches metaAndAssetCtxs from Hyperliquid (single bulk call, all ~200 assets)
 * - Updates asset prices, OI, funding rates, volume in hl_assets
 * - Optionally fetches fundingHistory for hourly snapshots
 */

import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { QUEUE_NAMES, AssetStatsJob } from '../common/queue/job-types';
import { queueConfigs } from '../common/queue/queue-config';
import { getHyperliquidClient } from '../common/hyperliquid-client';
import { getStorage } from '../common/storage';
import logger from '../common/logger';

async function processAssetStats(job: Job<AssetStatsJob>): Promise<void> {
  const { assetName, reason } = job.data;
  const hl = getHyperliquidClient();
  const storage = getStorage();

  logger.info(`[AssetStats] Processing ${assetName || 'all assets'} (reason: ${reason})`);

  try {
    // 1. Fetch metaAndAssetCtxs — single call returns ALL assets
    const metaAndCtxs = await hl.getMetaAndAssetCtxs();
    const meta = metaAndCtxs[0]; // { universe: [{ name, szDecimals, maxLeverage, ... }] }
    const assetCtxs = metaAndCtxs[1]; // [{ funding, openInterest, prevDayPx, dayNtlVlm, ... }]

    if (!meta?.universe || !assetCtxs) {
      logger.warn('[AssetStats] Invalid metaAndAssetCtxs response');
      return;
    }

    // 2. Fetch current mid prices
    const allMids = await hl.getAllMids();

    // 3. Build bulk update operations
    const now = new Date();
    const updates: Array<{ address: string; data: Record<string, any> }> = [];

    for (let i = 0; i < meta.universe.length; i++) {
      const assetMeta = meta.universe[i];
      const ctx = assetCtxs[i];
      const name = assetMeta.name;

      // If specific asset requested, skip others
      if (assetName && name !== assetName) continue;

      const midPrice = allMids[name] ? parseFloat(allMids[name]) : null;
      const prevDayPx = ctx.prevDayPx ? parseFloat(ctx.prevDayPx) : null;
      const priceChange24h = (midPrice && prevDayPx && prevDayPx > 0)
        ? ((midPrice - prevDayPx) / prevDayPx) * 100
        : null;

      const assetData: Record<string, any> = {
        name,
        midPrice,
        prevDayPx,
        priceChange24h,
        openInterest: ctx.openInterest ? parseFloat(ctx.openInterest) : 0,
        fundingRate: ctx.funding ? parseFloat(ctx.funding) : 0,
        dayVolume: ctx.dayNtlVlm ? parseFloat(ctx.dayNtlVlm) : 0,
        premium: ctx.premium ? parseFloat(ctx.premium) : null,
        oraclePx: ctx.oraclePx ? parseFloat(ctx.oraclePx) : null,
        impactPxs: ctx.impactPxs || null,

        // From meta
        szDecimals: assetMeta.szDecimals,
        maxLeverage: assetMeta.maxLeverage,
        onlyIsolated: assetMeta.onlyIsolated || false,

        lastUpdatedAt: now,
      };

      updates.push({ address: name, data: assetData });
    }

    // 4. Bulk upsert to hl_assets
    if (updates.length > 0) {
      const ops = updates.map(u => ({
        updateOne: {
          filter: { name: u.address },
          update: {
            $set: u.data,
            $setOnInsert: { firstSeenAt: now },
          },
          upsert: true,
        },
      }));

      await storage.assets().bulkWrite(ops as any, { ordered: false });
      logger.info(`[AssetStats] Updated ${updates.length} assets`);
    }

    // 5. Store funding snapshot if this is a funding-snapshot reason
    if (reason === 'funding-snapshot') {
      await storeFundingSnapshots(storage, updates, now);
    }

    logger.info(`[AssetStats] Completed ${assetName || `all ${updates.length} assets`}`);
  } catch (error: any) {
    logger.error(`[AssetStats] Failed: ${error.message}`);
    throw error;
  }
}

/**
 * Store current funding rates as historical snapshots.
 */
async function storeFundingSnapshots(
  storage: ReturnType<typeof getStorage>,
  updates: Array<{ address: string; data: Record<string, any> }>,
  timestamp: Date,
): Promise<void> {
  const snapshots = updates
    .filter(u => u.data.fundingRate !== null && u.data.fundingRate !== undefined)
    .map(u => ({
      coin: u.address,
      fundingRate: u.data.fundingRate,
      openInterest: u.data.openInterest,
      midPrice: u.data.midPrice,
      timestamp,
    }));

  if (snapshots.length > 0) {
    try {
      await storage.fundingHistory().insertMany(snapshots, { ordered: false });
      logger.info(`[AssetStats] Stored ${snapshots.length} funding snapshots`);
    } catch (error: any) {
      // Ignore duplicate key errors for idempotency
      if (error.code !== 11000) {
        logger.warn(`[AssetStats] Funding snapshot insert warning: ${error.message}`);
      }
    }
  }
}

export function createAssetStatsWorker(connection: Redis): Worker {
  const config = queueConfigs[QUEUE_NAMES.ASSET_STATS];

  const worker = new Worker<AssetStatsJob>(
    QUEUE_NAMES.ASSET_STATS,
    processAssetStats,
    {
      connection,
      concurrency: config.concurrency,
      limiter: config.limiter,
    },
  );

  worker.on('completed', (job) => {
    logger.debug(`[AssetStats] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`[AssetStats] Job ${job?.id} failed: ${err.message}`);
  });

  return worker;
}
