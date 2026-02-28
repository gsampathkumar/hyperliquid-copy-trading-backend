/**
 * Bootstrap Traders — One-time Bulk Ingestion
 *
 * Fetches the Hyperliquid leaderboard, iterates ALL traders,
 * backfills up to 10K fills each, computes metrics, stores everything.
 *
 * Resumable: tracks progress via checkpoint collection.
 *
 * Usage:
 *   npx ts-node analytics/batch_scripts/bootstrap-traders.ts
 *
 * Environment variables:
 *   BOOTSTRAP_BATCH_SIZE — concurrent trader processing (default: 5)
 *   BOOTSTRAP_SKIP_FILLS — skip fill backfill, only fetch portfolio+clearinghouse (default: false)
 */

import '../common/env';
import { getStorage, Storage } from '../common/storage';
import { getHyperliquidClient, HyperliquidClient, parsePortfolioResponse } from '../common/hyperliquid-client';
import { computeMetrics } from '../common/metrics';
import { TRADER_REFRESH_CONFIG } from '../common/config';
import logger from '../common/logger';

const LEADERBOARD_URL = 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard';
const CHECKPOINT_KEY = 'bootstrap-traders';

interface LeaderboardEntry {
  ethAddress: string;
  accountValue: string;
  displayName?: string;
  windowPerformances?: [string, { pnl: string; roi: string; vlm: string }][];
  [key: string]: any;
}

/**
 * Parse windowPerformances array of tuples into a keyed object.
 * Input: [["day", {pnl, roi, vlm}], ["week", ...], ...]
 * Output: { day: {pnl, roi, vlm}, week: ..., allTime: ... }
 */
function parseWindowPerformances(wp: LeaderboardEntry['windowPerformances']): Record<string, { pnl: string; roi: string; vlm: string }> {
  const result: Record<string, any> = {};
  if (!wp) return result;
  for (const [key, value] of wp) {
    result[key] = value;
  }
  return result;
}

async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  logger.info('[Bootstrap] Fetching leaderboard from stats-data.hyperliquid.xyz...');

  const response = await fetch(LEADERBOARD_URL);
  if (!response.ok) {
    throw new Error(`Leaderboard fetch failed: ${response.status} ${response.statusText}`);
  }

  const data: any = await response.json();

  // The leaderboard is a JSON array of trader entries
  const traders: LeaderboardEntry[] = Array.isArray(data) ? data : (data.leaderboardRows || data.traders || []);
  logger.info(`[Bootstrap] Fetched ${traders.length} traders from leaderboard`);

  return traders;
}

async function processTrader(
  hl: HyperliquidClient,
  storage: Storage,
  entry: LeaderboardEntry,
  index: number,
  total: number,
  skipFills: boolean,
): Promise<void> {
  const address = entry.ethAddress.toLowerCase() as `0x${string}`;
  const progress = `[${index + 1}/${total}]`;

  try {
    // 1. Fetch portfolio
    let portfolio: any = null;
    try {
      portfolio = await hl.getPortfolio(address);
    } catch (err: any) {
      logger.warn(`${progress} Portfolio failed for ${address}: ${err.message}`);
    }

    // 2. Fetch clearinghouseState
    let clearinghouse: any = null;
    try {
      clearinghouse = await hl.getClearinghouseState(address);
    } catch (err: any) {
      logger.warn(`${progress} ClearinghouseState failed for ${address}: ${err.message}`);
    }

    // 3. Build initial trader data (seed from leaderboard, enrich from API)
    const wp = parseWindowPerformances(entry.windowPerformances);
    const traderData: Record<string, any> = {
      lastSeenAt: new Date(),
      displayName: entry.displayName || null,
      // Seed from leaderboard data
      accountValue: parseFloat(entry.accountValue || '0'),
      allTimePnl: parseFloat(wp.allTime?.pnl || '0'),
      allTimeRoi: parseFloat(wp.allTime?.roi || '0'),
      dayPnl: parseFloat(wp.day?.pnl || '0'),
      weekPnl: parseFloat(wp.week?.pnl || '0'),
      monthPnl: parseFloat(wp.month?.pnl || '0'),
      totalVolume: parseFloat(wp.allTime?.vlm || '0'),
    };

    // Leaderboard source data (raw)
    traderData.leaderboardPnl = wp.allTime?.pnl || entry.accountValue || null;

    // Enrich from portfolio API (tuple array parsed by parsePortfolioResponse)
    const parsedPortfolio = parsePortfolioResponse(portfolio);
    if (parsedPortfolio) {
      traderData.allTimePnl = parsedPortfolio.allTime.pnl;
      const initialCapital = parsedPortfolio.allTime.accountValue - parsedPortfolio.allTime.pnl;
      traderData.allTimeRoi = initialCapital > 0
        ? parsedPortfolio.allTime.pnl / initialCapital
        : null;
      traderData.dayPnl = parsedPortfolio.day.pnl;
      traderData.weekPnl = parsedPortfolio.week.pnl;
      traderData.monthPnl = parsedPortfolio.month.pnl;
      traderData.accountValue = parsedPortfolio.allTime.accountValue;
      traderData.totalVolume = parsedPortfolio.allTime.vlm;
    }

    if (clearinghouse) {
      traderData.marginUsed = parseFloat(clearinghouse.marginSummary?.totalMarginUsed || '0');
      traderData.withdrawable = parseFloat(clearinghouse.withdrawable || '0');
      traderData.accountValue = parseFloat(clearinghouse.marginSummary?.accountValue || traderData.accountValue || '0');

      const positions = (clearinghouse.assetPositions || [])
        .map((ap: any) => ap.position)
        .filter((p: any) => p && Math.abs(parseFloat(p.szi || '0')) > 0);

      traderData.openPositionCount = positions.length;
      traderData.totalNotionalPosition = positions.reduce((sum: number, p: any) => {
        return sum + Math.abs(parseFloat(p.szi || '0') * parseFloat(p.entryPx || '0'));
      }, 0);

      if (positions.length > 0) {
        const leverages = positions
          .map((p: any) => parseFloat(p.leverage?.value || '1'))
          .filter((l: number) => l > 0);
        if (leverages.length > 0) {
          traderData.avgLeverage = leverages.reduce((s: number, l: number) => s + l, 0) / leverages.length;
        }
      }
    }

    // 4. Backfill fills (unless skipped)
    if (!skipFills) {
      try {
        const { fills, hitApiCap } = await hl.paginateUserFills(address, 10000, (count) => {
          if (count % 2000 === 0) {
            logger.debug(`${progress} ${address}: ${count} fills fetched`);
          }
        });

        if (fills.length > 0) {
          const fillDocs = fills.map((f: any) => ({
            traderAddress: address,
            coin: f.coin,
            px: f.px,
            sz: f.sz,
            side: f.side,
            time: f.time,
            hash: f.hash,
            tid: f.tid,
            closedPnl: f.closedPnl,
            fee: f.fee,
            oid: f.oid,
            dir: f.dir,
            crossed: f.crossed || false,
            feeToken: f.feeToken,
            startPosition: f.startPosition,
            liquidation: !!f.liquidation,
            source: 'rest',
          }));

          const { inserted: insertedCount } = await storage.bulkInsertFills(fillDocs);

          // Fetch funding payments for fundingAlpha
          let fundingPayments: any[] = [];
          try {
            fundingPayments = await hl.paginateUserFunding(address);
          } catch (err: any) {
            logger.warn(`${progress} Funding fetch failed for ${address}: ${err.message}`);
          }

          // Compute metrics from fills + funding
          const metrics = computeMetrics(fills, fundingPayments);
          Object.assign(traderData, metrics);

          traderData.totalFillsIngested = fills.length;
          traderData.fillsBackfilledFrom = new Date(fills[0].time);
          traderData.fillsFullyBackfilled = !hitApiCap;

          if (fills.length > 0) {
            const maxFillTime = Math.max(...fills.map((f: any) => f.time));
            traderData.lastTradeAt = new Date(maxFillTime);
          }

          logger.info(`${progress} ${address}: ${insertedCount} fills stored, PnL=${traderData.allTimePnl?.toFixed(2)}, winRate=${metrics.winRate.toFixed(1)}%`);
        } else {
          logger.info(`${progress} ${address}: no fills found, PnL=${traderData.allTimePnl?.toFixed(2)}`);
        }
      } catch (err: any) {
        logger.warn(`${progress} Fill backfill failed for ${address}: ${err.message}`);
      }
    } else {
      logger.info(`${progress} ${address}: skipping fills, PnL=${traderData.allTimePnl?.toFixed(2)}`);
    }

    // 5. Compute refresh tier based on last trade time
    const lastTradeMs = traderData.lastTradeAt ? traderData.lastTradeAt.getTime() : null;
    const now = Date.now();
    if (lastTradeMs && (now - lastTradeMs) < TRADER_REFRESH_CONFIG.ACTIVE_WINDOW_MS) {
      traderData.refreshTier = 'active';
      traderData.nextRefreshAt = new Date(now + TRADER_REFRESH_CONFIG.ACTIVE_INTERVAL_MS);
    } else if (lastTradeMs && (now - lastTradeMs) < TRADER_REFRESH_CONFIG.RECENT_WINDOW_MS) {
      traderData.refreshTier = 'recent';
      traderData.nextRefreshAt = new Date(now + TRADER_REFRESH_CONFIG.RECENT_INTERVAL_MS);
    } else {
      traderData.refreshTier = 'stale';
      traderData.nextRefreshAt = new Date(now + TRADER_REFRESH_CONFIG.STALE_INTERVAL_MS);
    }

    // 6. Upsert trader + mark as processed
    await storage.upsertTrader(address, traderData);
    await storage.markTraderProcessed(address);

  } catch (error: any) {
    logger.error(`${progress} Failed to process ${address}: ${error.message}`);
    // Don't throw — continue with next trader
  }
}

async function main(): Promise<void> {
  const startTime = Date.now();
  const batchSize = parseInt(process.env.BOOTSTRAP_BATCH_SIZE || '5', 10);
  const skipFills = process.env.BOOTSTRAP_SKIP_FILLS === 'true';

  logger.info(`[Bootstrap] Starting trader bootstrap (batchSize=${batchSize}, skipFills=${skipFills})`);

  // Connect
  const storage = getStorage();
  await storage.connect();
  const hl = getHyperliquidClient();

  try {
    // Fetch leaderboard
    const leaderboard = await fetchLeaderboard();

    if (leaderboard.length === 0) {
      logger.error('[Bootstrap] No traders found in leaderboard');
      return;
    }

    // Check for resume point
    const checkpoint = await storage.getCheckpoint(CHECKPOINT_KEY);
    let startIndex = 0;

    if (checkpoint && checkpoint.lastProcessedIndex !== undefined) {
      startIndex = checkpoint.lastProcessedIndex + 1;
      logger.info(`[Bootstrap] Resuming from index ${startIndex} (${leaderboard.length - startIndex} remaining)`);
    }

    // Process traders in batches
    let processed = 0;
    let errors = 0;

    for (let i = startIndex; i < leaderboard.length; i += batchSize) {
      const batch = leaderboard.slice(i, i + batchSize);

      // Process batch concurrently
      const results = await Promise.allSettled(
        batch.map((entry, j) =>
          processTrader(hl, storage, entry, i + j, leaderboard.length, skipFills)
        )
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          processed++;
        } else {
          errors++;
        }
      }

      // Save checkpoint
      await storage.setCheckpoint(CHECKPOINT_KEY, {
        lastProcessedIndex: Math.min(i + batchSize - 1, leaderboard.length - 1),
        totalTraders: leaderboard.length,
        processed,
        errors,
        elapsedMs: Date.now() - startTime,
      });

      // Progress log every 50 traders
      if ((i + batchSize) % 50 < batchSize) {
        const elapsedMin = (Date.now() - startTime) / 1000 / 60;
        const elapsed = elapsedMin.toFixed(1);
        const rate = elapsedMin > 0 ? processed / elapsedMin : 0;
        const remaining = leaderboard.length - i - batchSize;
        const eta = rate > 0 ? (remaining / rate).toFixed(1) : '?';
        logger.info(`[Bootstrap] Progress: ${i + batchSize}/${leaderboard.length} | ${processed} OK, ${errors} errors | ${elapsed}min elapsed, ~${eta}min ETA | ${rate.toFixed(1)} traders/min`);
      }
    }

    const totalElapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    logger.info(`[Bootstrap] COMPLETE: ${processed} traders processed, ${errors} errors, ${totalElapsed} minutes total`);

    // Mark bootstrap complete
    await storage.setCheckpoint(CHECKPOINT_KEY, {
      status: 'complete',
      totalTraders: leaderboard.length,
      processed,
      errors,
      elapsedMs: Date.now() - startTime,
      completedAt: new Date(),
    });

  } finally {
    await storage.disconnect();
  }
}

// Run
main().catch(err => {
  logger.error(`[Bootstrap] Fatal error: ${err.message}`);
  process.exit(1);
});
