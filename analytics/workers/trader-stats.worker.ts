/**
 * Trader Stats Worker
 *
 * Processes hl-trader-stats jobs:
 * - Fetches clearinghouseState + portfolio from Hyperliquid
 * - Fetches new fills since last update
 * - Computes all performance metrics
 * - Stores/updates in hl_traders + hl_fills collections
 */

import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { QUEUE_NAMES, TraderStatsJob } from '../common/queue/job-types';
import { queueConfigs } from '../common/queue/queue-config';
import { getHyperliquidClient, parsePortfolioResponse } from '../common/hyperliquid-client';
import { getStorage } from '../common/storage';
import { computeMetrics } from '../common/metrics';
import logger from '../common/logger';
import { TRADER_REFRESH_CONFIG } from '../common/config';

/**
 * Compute fill rate (fills per hour) from stored fill timestamps.
 * Stored as a useful stat on the trader doc, but NOT used for scheduling.
 */
function computeFillRate(fills: any[]): number | null {
  if (fills.length < 2) return null;

  // fills are sorted desc (newest first) from storage
  const newestTime = fills[0].time;
  const oldestTime = fills[fills.length - 1].time;
  const spanMs = newestTime - oldestTime;

  if (spanMs <= 0) return null;

  const spanHours = spanMs / (1000 * 60 * 60);
  return fills.length / spanHours;
}

/**
 * Compute next refresh time based on trader activity tier.
 *
 * Tier 1 (Active):  traded in last 24h → ACTIVE_INTERVAL
 * Tier 2 (Recent):  traded in last 7d  → RECENT_INTERVAL
 * Tier 3 (Stale):   no trades in 7d+   → STALE_INTERVAL
 *
 * Intervals are configurable in config.ts — start at 24h, tune down.
 */
function computeNextRefreshAt(lastTradeTime: number | null): { nextRefreshAt: Date; refreshTier: string } {
  const now = Date.now();

  if (lastTradeTime && (now - lastTradeTime) < TRADER_REFRESH_CONFIG.ACTIVE_WINDOW_MS) {
    return {
      nextRefreshAt: new Date(now + TRADER_REFRESH_CONFIG.ACTIVE_INTERVAL_MS),
      refreshTier: 'active',
    };
  }

  if (lastTradeTime && (now - lastTradeTime) < TRADER_REFRESH_CONFIG.RECENT_WINDOW_MS) {
    return {
      nextRefreshAt: new Date(now + TRADER_REFRESH_CONFIG.RECENT_INTERVAL_MS),
      refreshTier: 'recent',
    };
  }

  return {
    nextRefreshAt: new Date(now + TRADER_REFRESH_CONFIG.STALE_INTERVAL_MS),
    refreshTier: 'stale',
  };
}

async function processTraderStats(job: Job<TraderStatsJob>): Promise<void> {
  const { traderAddress, reason } = job.data;
  const address = traderAddress.toLowerCase() as `0x${string}`;
  const storage = getStorage();
  const hl = getHyperliquidClient();

  logger.info(`[TraderStats] Processing ${address} (reason: ${reason})`);

  try {
    // 1. Fetch portfolio (allTime PnL, day/week/month PnL)
    let portfolio: any = null;
    try {
      portfolio = await hl.getPortfolio(address);
    } catch (err: any) {
      logger.warn(`[TraderStats] Portfolio fetch failed for ${address}: ${err.message}`);
    }

    // 2. Fetch clearinghouseState (current positions, account value)
    let clearinghouse: any = null;
    try {
      clearinghouse = await hl.getClearinghouseState(address);
    } catch (err: any) {
      logger.warn(`[TraderStats] ClearinghouseState fetch failed for ${address}: ${err.message}`);
    }

    // 3. Fetch new fills since last known fill
    const latestFillTime = await storage.getLatestFillTime(address);
    const startTime = latestFillTime ? latestFillTime + 1 : 0;

    let newFills: any[] = [];
    let hitApiCap = false;
    try {
      if (reason === 'discovery' || reason === 'manual') {
        // Full backfill for new traders
        const result = await hl.paginateUserFills(address, 10000, (count) => {
          logger.debug(`[TraderStats] ${address}: fetched ${count} fills so far`);
        });
        newFills = result.fills;
        hitApiCap = result.hitApiCap;
      } else {
        // Incremental: just get fills since last known
        newFills = await hl.getUserFillsByTime(address, startTime);
      }
    } catch (err: any) {
      logger.warn(`[TraderStats] Fills fetch failed for ${address}: ${err.message}`);
    }

    // 4. Fetch funding payments for fundingAlpha computation
    let fundingPayments: any[] = [];
    try {
      fundingPayments = await hl.paginateUserFunding(address);
    } catch (err: any) {
      logger.warn(`[TraderStats] Funding fetch failed for ${address}: ${err.message}`);
    }

    // 5. Store new fills and detect gaps
    let insertResult = { inserted: 0, duplicates: 0 };
    if (newFills.length > 0) {
      const fillDocs = newFills.map(f => ({
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

      insertResult = await storage.bulkInsertFills(fillDocs);
      logger.info(`[TraderStats] ${address}: ${insertResult.inserted} new, ${insertResult.duplicates} dups (${newFills.length} fetched)`);

      // Gap detection: on incremental refresh, zero duplicates = possible data gap
      if (reason === 'scheduled' && insertResult.duplicates === 0 && insertResult.inserted > 0) {
        logger.warn(`[TraderStats] GAP WARNING: ${address} — zero duplicate fills on refresh. Possible data gap between stored and API window.`);
      }
    }

    // 6. Compute metrics from ALL stored fills + funding
    const allFills = await storage.getTraderFills(address, 10000);
    const metrics = computeMetrics(allFills, fundingPayments);

    // 7. Build trader update document
    const traderUpdate: Record<string, any> = {
      lastSeenAt: new Date(),
      ...metrics,
    };

    // Portfolio data (SDK returns tuple array, parsePortfolioResponse extracts latest values)
    const parsedPortfolio = parsePortfolioResponse(portfolio);
    if (parsedPortfolio) {
      traderUpdate.allTimePnl = parsedPortfolio.allTime.pnl;
      const initialCapital = parsedPortfolio.allTime.accountValue - parsedPortfolio.allTime.pnl;
      traderUpdate.allTimeRoi = initialCapital > 0
        ? parsedPortfolio.allTime.pnl / initialCapital
        : null;
      traderUpdate.dayPnl = parsedPortfolio.day.pnl;
      traderUpdate.weekPnl = parsedPortfolio.week.pnl;
      traderUpdate.monthPnl = parsedPortfolio.month.pnl;
      traderUpdate.accountValue = parsedPortfolio.allTime.accountValue;
      traderUpdate.totalVolume = parsedPortfolio.allTime.vlm;
    }

    // Clearinghouse data
    if (clearinghouse) {
      traderUpdate.marginUsed = parseFloat(clearinghouse.marginSummary?.totalMarginUsed || '0');
      traderUpdate.withdrawable = parseFloat(clearinghouse.withdrawable || '0');
      traderUpdate.accountValue = parseFloat(clearinghouse.marginSummary?.accountValue || traderUpdate.accountValue || '0');

      const positions = (clearinghouse.assetPositions || [])
        .map((ap: any) => ap.position)
        .filter((p: any) => p && Math.abs(parseFloat(p.szi || '0')) > 0);

      traderUpdate.openPositionCount = positions.length;
      traderUpdate.totalNotionalPosition = positions.reduce((sum: number, p: any) => {
        return sum + Math.abs(parseFloat(p.szi || '0') * parseFloat(p.entryPx || '0'));
      }, 0);

      // Update avg leverage from current positions
      if (positions.length > 0) {
        const leverages = positions
          .map((p: any) => parseFloat(p.leverage?.value || '1'))
          .filter((l: number) => l > 0);
        if (leverages.length > 0) {
          traderUpdate.avgLeverage = leverages.reduce((s: number, l: number) => s + l, 0) / leverages.length;
        }
      }

    }

    // Detect last trade time from fills (find the most recent timestamp)
    if (newFills.length > 0) {
      const maxFillTime = Math.max(...newFills.map((f: any) => f.time));
      traderUpdate.lastTradeAt = new Date(maxFillTime);
    }

    // 8. Backfill tracking
    const totalFillsStored = await storage.getTraderFillCount(address);
    traderUpdate.totalFillsIngested = totalFillsStored;
    if (allFills.length > 0) {
      traderUpdate.fillsBackfilledFrom = new Date(allFills[allFills.length - 1].time); // Oldest fill (sorted desc)
    }
    if (reason === 'discovery' || reason === 'manual') {
      traderUpdate.fillsFullyBackfilled = !hitApiCap;
    }

    // 9. Tier-based refresh scheduling
    const fillRate = computeFillRate(allFills);
    traderUpdate.fillRate = fillRate;

    // Determine last trade time for tier classification
    const lastTradeMs = traderUpdate.lastTradeAt
      ? traderUpdate.lastTradeAt.getTime()
      : (allFills.length > 0 ? allFills[0].time : null);

    const { nextRefreshAt, refreshTier } = computeNextRefreshAt(lastTradeMs);
    traderUpdate.nextRefreshAt = nextRefreshAt;
    traderUpdate.refreshTier = refreshTier;

    const intervalHrs = (nextRefreshAt.getTime() - Date.now()) / (1000 * 60 * 60);
    logger.info(`[TraderStats] ${address}: tier=${refreshTier}, fillRate=${fillRate?.toFixed(1) ?? 'N/A'}/hr, nextRefresh in ${intervalHrs.toFixed(1)}h`);

    // 10. Upsert trader
    await storage.upsertTrader(address, traderUpdate);
    await storage.markTraderProcessed(address);

    logger.info(`[TraderStats] Completed ${address}: ${totalFillsStored} fills, PnL=${traderUpdate.allTimePnl?.toFixed(2)}, winRate=${metrics.winRate.toFixed(1)}%`);
  } catch (error: any) {
    logger.error(`[TraderStats] Failed processing ${address}: ${error.message}`);
    throw error;
  }
}

export function createTraderStatsWorker(connection: Redis): Worker {
  const config = queueConfigs[QUEUE_NAMES.TRADER_STATS];

  const worker = new Worker<TraderStatsJob>(
    QUEUE_NAMES.TRADER_STATS,
    processTraderStats,
    {
      connection,
      concurrency: config.concurrency,
      limiter: config.limiter,
    }
  );

  worker.on('completed', (job) => {
    logger.debug(`[TraderStats] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`[TraderStats] Job ${job?.id} failed: ${err.message}`);
  });

  return worker;
}
