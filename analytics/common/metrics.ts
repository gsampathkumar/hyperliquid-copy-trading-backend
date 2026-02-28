/**
 * Trading Metrics Computation Engine
 *
 * Computes performance metrics from Hyperliquid fills:
 * Sharpe, Sortino, drawdown, Kelly, profit factor, win rate,
 * avg leverage, avg hold time, trader style, funding alpha.
 */

export interface FillRecord {
  coin: string;
  px: string;
  sz: string;
  side: string; // 'B' or 'A'
  time: number;
  closedPnl: string;
  fee: string;
  dir?: string; // 'Open Long', 'Close Long', 'Open Short', 'Close Short'
  startPosition?: string;
  liquidation?: boolean;
}

export interface TraderMetrics {
  totalTrades: number;
  totalVolume: number;
  winRate: number;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  maxDrawdown: number | null;
  maxDrawdownPercent: number | null;
  kellyFraction: number | null;
  profitFactor: number | null;
  avgLeverage: number | null;
  avgHoldTimeMs: number | null;
  traderStyle: string | null;
  fundingAlpha: number | null;
  liquidationCount: number;
}

interface ClosedTrade {
  coin: string;
  pnl: number;
  volume: number;
  openTime: number;
  closeTime: number;
  leverage: number;
  direction: 'long' | 'short';
}

/**
 * Compute all metrics from a set of fills.
 */
export function computeMetrics(fills: FillRecord[], fundingPayments?: any[]): TraderMetrics {
  if (!fills || fills.length === 0) {
    return emptyMetrics();
  }

  // Sort fills by time ascending
  const sorted = [...fills].sort((a, b) => a.time - b.time);

  const totalTrades = sorted.length;
  const totalVolume = sorted.reduce((sum, f) => sum + parseFloat(f.px) * parseFloat(f.sz), 0);
  const liquidationCount = sorted.filter(f => f.liquidation).length;

  // Extract closed trade PnLs from fills, deducting fees for consistency with equity curve
  const closedPnls = sorted
    .map(f => {
      const pnl = parseFloat(f.closedPnl);
      const fee = parseFloat(f.fee || '0');
      return pnl - fee;
    })
    .filter(pnl => pnl !== 0);

  // Reconstruct closed trades from fill directions
  const closedTrades = reconstructClosedTrades(sorted);

  // Win/loss from closed PnLs
  const wins = closedPnls.filter(p => p > 0);
  const losses = closedPnls.filter(p => p < 0);
  const winRate = closedPnls.length > 0
    ? (wins.length / closedPnls.length) * 100
    : 0;

  // Profit factor
  const grossProfit = wins.reduce((s, p) => s + p, 0);
  const grossLoss = Math.abs(losses.reduce((s, p) => s + p, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : null);

  // Equity curve from cumulative closed PnL
  const equityCurve = buildEquityCurve(sorted);

  // Sharpe ratio (trade-level returns)
  const sharpeRatio = computeSharpe(closedPnls);

  // Sortino ratio (only penalizes downside deviation)
  const sortinoRatio = computeSortino(closedPnls);

  // Max drawdown
  const { maxDrawdown, maxDrawdownPercent } = computeDrawdown(equityCurve);

  // Kelly fraction
  const kellyFraction = computeKelly(wins, losses);

  // Avg leverage from fills
  const avgLeverage = computeAvgLeverage(sorted);

  // Avg hold time from closed trades
  const avgHoldTimeMs = computeAvgHoldTime(closedTrades);

  // Trader style based on hold times
  const traderStyle = classifyTraderStyle(closedTrades);

  // Funding alpha
  const fundingAlpha = computeFundingAlpha(fundingPayments);

  return {
    totalTrades,
    totalVolume,
    winRate,
    sharpeRatio,
    sortinoRatio,
    maxDrawdown,
    maxDrawdownPercent,
    kellyFraction,
    profitFactor: profitFactor === Infinity ? 999 : profitFactor,
    avgLeverage,
    avgHoldTimeMs,
    traderStyle,
    fundingAlpha,
    liquidationCount,
  };
}

function emptyMetrics(): TraderMetrics {
  return {
    totalTrades: 0,
    totalVolume: 0,
    winRate: 0,
    sharpeRatio: null,
    sortinoRatio: null,
    maxDrawdown: null,
    maxDrawdownPercent: null,
    kellyFraction: null,
    profitFactor: null,
    avgLeverage: null,
    avgHoldTimeMs: null,
    traderStyle: null,
    fundingAlpha: null,
    liquidationCount: 0,
  };
}

/**
 * Build equity curve from cumulative closed PnL on each fill.
 */
function buildEquityCurve(fills: FillRecord[]): { time: number; equity: number }[] {
  let cumPnl = 0;
  const curve: { time: number; equity: number }[] = [];

  for (const fill of fills) {
    const closedPnl = parseFloat(fill.closedPnl);
    const fee = parseFloat(fill.fee);
    cumPnl += closedPnl - fee;
    curve.push({ time: fill.time, equity: cumPnl });
  }

  return curve;
}

/**
 * Sharpe ratio from trade PnLs.
 * Sharpe = mean(returns) / std(returns)
 */
function computeSharpe(pnls: number[]): number | null {
  if (pnls.length < 2) return null;

  const mean = pnls.reduce((s, p) => s + p, 0) / pnls.length;
  const variance = pnls.reduce((s, p) => s + Math.pow(p - mean, 2), 0) / (pnls.length - 1);
  const std = Math.sqrt(variance);

  if (std === 0) return null;
  return mean / std;
}

/**
 * Sortino ratio — like Sharpe but only penalizes downside deviation.
 * Sortino = mean(returns) / downside_std(returns)
 */
function computeSortino(pnls: number[]): number | null {
  if (pnls.length < 2) return null;

  const mean = pnls.reduce((s, p) => s + p, 0) / pnls.length;
  const downsideReturns = pnls.filter(p => p < 0);

  if (downsideReturns.length === 0) return pnls.length > 1 ? 999 : null; // No downside = very good

  // Sortino uses all observations in denominator: sqrt(sum(min(r,0)^2) / N)
  const downsideVariance = downsideReturns.reduce((s, p) => s + Math.pow(p, 2), 0) / pnls.length;
  const downsideStd = Math.sqrt(downsideVariance);

  if (downsideStd === 0) return null;
  return mean / downsideStd;
}

/**
 * Max drawdown from equity curve.
 */
function computeDrawdown(curve: { time: number; equity: number }[]): {
  maxDrawdown: number | null;
  maxDrawdownPercent: number | null;
} {
  if (curve.length < 2) return { maxDrawdown: null, maxDrawdownPercent: null };

  let peak = curve[0].equity;
  let maxDD = 0;
  let maxDDPercent = 0;

  for (const point of curve) {
    if (point.equity > peak) {
      peak = point.equity;
    }
    const dd = peak - point.equity;
    if (dd > maxDD) {
      maxDD = dd;
      if (peak > 0) {
        maxDDPercent = (dd / peak) * 100;
      }
    }
  }

  return {
    maxDrawdown: maxDD > 0 ? -maxDD : null,
    maxDrawdownPercent: maxDDPercent > 0 ? maxDDPercent : null,
  };
}

/**
 * Kelly fraction = W - (1-W)/R
 * W = win rate, R = avg win / avg loss ratio
 * Capped at 0.25 (quarter Kelly for safety)
 */
function computeKelly(wins: number[], losses: number[]): number | null {
  if (wins.length === 0 || losses.length === 0) return null;

  const winRate = wins.length / (wins.length + losses.length);
  const avgWin = wins.reduce((s, w) => s + w, 0) / wins.length;
  const avgLoss = Math.abs(losses.reduce((s, l) => s + l, 0) / losses.length);

  if (avgLoss === 0) return null;

  const winLossRatio = avgWin / avgLoss;
  const kelly = winRate - (1 - winRate) / winLossRatio;

  // Cap at 0.25 (quarter Kelly)
  return Math.min(kelly, 0.25);
}

/**
 * Reconstruct closed trades by matching open/close fills.
 */
function reconstructClosedTrades(fills: FillRecord[]): ClosedTrade[] {
  const trades: ClosedTrade[] = [];

  // Group by coin, track open positions (only set on first open, not scale-in)
  const openPositions = new Map<string, { direction: 'long' | 'short'; openTime: number; leverage: number }>();

  for (const fill of fills) {
    const dir = fill.dir || '';
    const coin = fill.coin;

    if (dir.startsWith('Open')) {
      // Only record open time on initial position open, not on scale-in
      if (!openPositions.has(coin)) {
        const direction = dir.includes('Long') ? 'long' as const : 'short' as const;
        openPositions.set(coin, { direction, openTime: fill.time, leverage: 1 });
      }
    } else if (dir.startsWith('Close')) {
      const open = openPositions.get(coin);
      if (open) {
        const pnl = parseFloat(fill.closedPnl) - parseFloat(fill.fee || '0');
        const volume = parseFloat(fill.px) * parseFloat(fill.sz);

        trades.push({
          coin,
          pnl,
          volume,
          openTime: open.openTime,
          closeTime: fill.time,
          leverage: open.leverage,
          direction: open.direction,
        });

        // Check if position is fully closed
        const remainingPos = Math.abs(parseFloat(fill.startPosition || '0')) - parseFloat(fill.sz);
        if (Math.abs(remainingPos) < 0.0001) {
          openPositions.delete(coin);
        }
      }
    }
  }

  return trades;
}

/**
 * Average leverage from fills.
 * Uses startPosition and size to estimate leverage where possible.
 */
function computeAvgLeverage(fills: FillRecord[]): number | null {
  // We don't have direct leverage info from fills.
  // This will be enriched from clearinghouseState later.
  return null;
}

/**
 * Average hold time from closed trades.
 */
function computeAvgHoldTime(trades: ClosedTrade[]): number | null {
  if (trades.length === 0) return null;

  const holdTimes = trades.map(t => t.closeTime - t.openTime);
  return holdTimes.reduce((s, t) => s + t, 0) / holdTimes.length;
}

/**
 * Classify trader style based on average hold time.
 */
function classifyTraderStyle(trades: ClosedTrade[]): string | null {
  if (trades.length < 3) return null;

  const avgHoldMs = computeAvgHoldTime(trades);
  if (avgHoldMs === null) return null;

  const hours = avgHoldMs / (1000 * 60 * 60);

  if (hours < 1) return 'scalper';
  if (hours < 24) return 'day_trader';
  if (hours < 168) return 'swing'; // < 1 week
  return 'position';
}

/**
 * Funding alpha: net funding earned vs total funding paid.
 * Positive = trader earns funding on average (favorable positions).
 */
function computeFundingAlpha(fundingPayments?: any[]): number | null {
  if (!fundingPayments || fundingPayments.length === 0) return null;

  const totalFunding = fundingPayments.reduce((sum, fp) => {
    const payment = parseFloat(fp.usdc || fp.delta?.usdc || '0');
    return sum + payment;
  }, 0);

  return totalFunding;
}
