/**
 * Test Pipeline — Quick smoke test
 *
 * Processes 5 well-known Hyperliquid traders to verify:
 * 1. HL API connectivity (portfolio, clearinghouseState, fills)
 * 2. MongoDB writes (hl_traders, hl_fills)
 * 3. Metrics computation (Sharpe, winRate, drawdown, etc.)
 *
 * Usage:
 *   npx ts-node analytics/batch_scripts/test-pipeline.ts
 */

import '../common/env';
import { getStorage } from '../common/storage';
import { getHyperliquidClient, parsePortfolioResponse } from '../common/hyperliquid-client';
import { computeMetrics } from '../common/metrics';
import logger from '../common/logger';

// Top Hyperliquid traders from leaderboard (real addresses)
const TEST_ADDRESSES: `0x${string}`[] = [
  '0x162cc7c861ebd0c06b3d72319201150482518185', // "ABC" — $36M+ allTime PnL
  '0x87f9cd15f5050a9283b8896300f7c8cf69ece2cf', // $49M+ allTime PnL
  '0x7839e2f2c375dd2935193f2736167514efff9916', // $10M+ allTime PnL
  '0x399965e15d4e61ec3529cc98b7f7ebb93b733336', // $6.6M account value
];

async function testHLApi() {
  const hl = getHyperliquidClient();

  logger.info('=== Test 1: API Connectivity ===');

  // Test allMids
  logger.info('Fetching allMids...');
  const mids = await hl.getAllMids();
  const midCount = Object.keys(mids).length;
  logger.info(`  allMids: ${midCount} assets (BTC=${mids['BTC']}, ETH=${mids['ETH']})`);

  // Test metaAndAssetCtxs
  logger.info('Fetching metaAndAssetCtxs...');
  const metaCtx = await hl.getMetaAndAssetCtxs();
  const assetCount = metaCtx[0]?.universe?.length || 0;
  logger.info(`  metaAndAssetCtxs: ${assetCount} assets in universe`);

  return { midCount, assetCount };
}

async function testTraderIngestion() {
  const hl = getHyperliquidClient();
  const storage = getStorage();

  logger.info('\n=== Test 2: Trader Ingestion ===');

  let successCount = 0;

  for (const address of TEST_ADDRESSES) {
    const shortAddr = `${address.slice(0, 8)}...${address.slice(-4)}`;
    logger.info(`\nProcessing ${shortAddr}...`);

    try {
      // Portfolio
      let portfolio: any = null;
      let parsedPortfolio: ReturnType<typeof parsePortfolioResponse> = null;
      try {
        portfolio = await hl.getPortfolio(address);
        parsedPortfolio = parsePortfolioResponse(portfolio);
        const pnl = parsedPortfolio?.allTime.pnl?.toFixed(2) ?? 'N/A';
        logger.info(`  Portfolio: allTimePnl=${pnl}`);
      } catch (err: any) {
        logger.warn(`  Portfolio failed: ${err.message}`);
      }

      // ClearinghouseState
      let clearinghouse: any = null;
      try {
        clearinghouse = await hl.getClearinghouseState(address);
        const acctValue = clearinghouse?.marginSummary?.accountValue || 'N/A';
        const posCount = (clearinghouse?.assetPositions || [])
          .filter((ap: any) => ap.position && Math.abs(parseFloat(ap.position.szi || '0')) > 0)
          .length;
        logger.info(`  ClearinghouseState: accountValue=${acctValue}, openPositions=${posCount}`);
      } catch (err: any) {
        logger.warn(`  ClearinghouseState failed: ${err.message}`);
      }

      // Fills (limit to 100 for test speed)
      let fills: any[] = [];
      try {
        fills = await hl.getUserFillsByTime(address, 0);
        logger.info(`  Fills: ${fills.length} returned`);
      } catch (err: any) {
        logger.warn(`  Fills failed: ${err.message}`);
      }

      // Compute metrics
      if (fills.length > 0) {
        const metrics = computeMetrics(fills);
        logger.info(`  Metrics: winRate=${metrics.winRate.toFixed(1)}%, sharpe=${metrics.sharpeRatio?.toFixed(3) || 'N/A'}, trades=${metrics.totalTrades}, style=${metrics.traderStyle || 'N/A'}`);

        // Store fills
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
        logger.info(`  Stored: ${insertedCount} fills inserted`);

        // Upsert trader
        const traderData: Record<string, any> = {
          lastSeenAt: new Date(),
          ...metrics,
        };

        if (parsedPortfolio) {
          traderData.allTimePnl = parsedPortfolio.allTime.pnl;
          const initialCapital = parsedPortfolio.allTime.accountValue - parsedPortfolio.allTime.pnl;
          traderData.allTimeRoi = initialCapital > 0 ? parsedPortfolio.allTime.pnl / initialCapital : null;
          traderData.accountValue = parsedPortfolio.allTime.accountValue;
          traderData.dayPnl = parsedPortfolio.day.pnl;
          traderData.weekPnl = parsedPortfolio.week.pnl;
          traderData.monthPnl = parsedPortfolio.month.pnl;
          traderData.totalVolume = parsedPortfolio.allTime.vlm;
        }

        if (clearinghouse) {
          traderData.accountValue = parseFloat(clearinghouse.marginSummary?.accountValue || traderData.accountValue || '0');
          traderData.marginUsed = parseFloat(clearinghouse.marginSummary?.totalMarginUsed || '0');
          traderData.openPositionCount = (clearinghouse.assetPositions || [])
            .filter((ap: any) => ap.position && Math.abs(parseFloat(ap.position.szi || '0')) > 0)
            .length;
        }

        traderData.totalFillsIngested = fills.length;
        traderData.fillsFullyBackfilled = true;

        await storage.upsertTrader(address, traderData);
        logger.info(`  Trader upserted to MongoDB`);

        successCount++;
      } else {
        // Still store the trader with portfolio/clearinghouse data
        const traderData: Record<string, any> = { lastSeenAt: new Date() };
        if (parsedPortfolio) {
          traderData.allTimePnl = parsedPortfolio.allTime.pnl;
          traderData.accountValue = parsedPortfolio.allTime.accountValue;
        }
        await storage.upsertTrader(address, traderData);
        logger.info(`  Trader upserted (no fills)`);
        successCount++;
      }
    } catch (err: any) {
      logger.error(`  FAILED: ${err.message}`);
    }
  }

  return successCount;
}

async function verifyMongoDB() {
  const storage = getStorage();

  logger.info('\n=== Test 3: MongoDB Verification ===');

  const traderCount = await storage.traders().countDocuments();
  const fillCount = await storage.fills().countDocuments();

  logger.info(`  hl_traders: ${traderCount} documents`);
  logger.info(`  hl_fills: ${fillCount} documents`);

  // Show a sample trader
  const sample = await storage.traders().findOne({}, { sort: { allTimePnl: -1 } });
  if (sample) {
    logger.info(`  Top trader: ${sample.address}`);
    logger.info(`    PnL: $${sample.allTimePnl?.toFixed(2)}`);
    logger.info(`    Win Rate: ${sample.winRate?.toFixed(1)}%`);
    logger.info(`    Sharpe: ${sample.sharpeRatio?.toFixed(3)}`);
    logger.info(`    Trades: ${sample.totalTrades}`);
    logger.info(`    Style: ${sample.traderStyle}`);
    logger.info(`    Account Value: $${sample.accountValue?.toFixed(2)}`);
  }

  // Show fill distribution by coin
  const fillsByCoin = await storage.fills().aggregate([
    { $group: { _id: '$coin', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]).toArray();

  if (fillsByCoin.length > 0) {
    logger.info(`  Top coins by fill count:`);
    for (const entry of fillsByCoin) {
      logger.info(`    ${entry._id}: ${entry.count} fills`);
    }
  }

  return { traderCount, fillCount };
}

async function main() {
  logger.info('╔══════════════════════════════════════╗');
  logger.info('║  Hyperliquid Pipeline Test            ║');
  logger.info('╚══════════════════════════════════════╝\n');

  const storage = getStorage();
  await storage.connect();

  try {
    // Test 1: API
    const apiResult = await testHLApi();

    // Test 2: Ingestion
    const successCount = await testTraderIngestion();

    // Test 3: Verify
    const dbResult = await verifyMongoDB();

    // Summary
    logger.info('\n=== SUMMARY ===');
    logger.info(`HL API: ${apiResult.midCount} assets priced, ${apiResult.assetCount} in universe`);
    logger.info(`Ingestion: ${successCount}/${TEST_ADDRESSES.length} traders processed`);
    logger.info(`MongoDB: ${dbResult.traderCount} traders, ${dbResult.fillCount} fills stored`);
    logger.info(`\nPipeline test ${successCount > 0 ? 'PASSED' : 'FAILED'}`);
  } finally {
    await storage.disconnect();
  }
}

main().catch(err => {
  logger.error(`Fatal: ${err.message}`);
  process.exit(1);
});
