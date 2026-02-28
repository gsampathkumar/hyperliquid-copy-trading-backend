/**
 * Configuration constants for the Hyperliquid analytics pipeline
 *
 * Centralizes configurable values like refresh intervals and staleness thresholds.
 * Tune these down as processing capacity increases.
 */

// ============================================================================
// Trader Refresh Scheduling (tier-based)
// ============================================================================
// Start conservative at 24h, tune down to 12h → 6h → 4h as capacity allows.

export const TRADER_REFRESH_CONFIG = {
  // Tier 1: Active — traded within last 24 hours
  ACTIVE_INTERVAL_MS: 24 * 60 * 60 * 1000,   // 24h (tune to 12h → 6h → 4h)
  ACTIVE_WINDOW_MS: 24 * 60 * 60 * 1000,      // "last 24h" = active

  // Tier 2: Recent — traded within last 7 days (but not last 24h)
  RECENT_INTERVAL_MS: 24 * 60 * 60 * 1000,    // 24h (tune to 12h)
  RECENT_WINDOW_MS: 7 * 24 * 60 * 60 * 1000,  // "last 7d" = recent

  // Tier 3: Stale — no trades in 7+ days
  STALE_INTERVAL_MS: 24 * 60 * 60 * 1000,     // 24h (fixed)
} as const;

// ============================================================================
// Asset Refresh Scheduling (bulk)
// ============================================================================
// All assets updated in a single metaAndAssetCtxs call. No per-entity scheduling.

export const ASSET_REFRESH_CONFIG = {
  // Price + OI + volume — single bulk call refreshes all ~200 assets
  PRICE_INTERVAL_MS: 5 * 60 * 1000,           // 5min (tune to 1min)

  // Funding rate history — per-coin snapshots stored hourly
  FUNDING_SNAPSHOT_INTERVAL_MS: 60 * 60 * 1000, // 1h (fixed, matches HL funding period)
} as const;

// ============================================================================
// Legacy staleness thresholds (for real-time pipeline debouncing)
// ============================================================================

export const STALENESS_CONFIG = {
  // Real-time pipeline: skip update if entity was updated within this window
  TRADER_REALTIME_THRESHOLD_MS: 12 * 60 * 60 * 1000, // 12 hours
  ASSET_REALTIME_THRESHOLD_MS: 60 * 1000, // 1 minute

  // Catch-up: consider entity stale if not updated within this window
  TRADER_CATCHUP_THRESHOLD_MS: 72 * 60 * 60 * 1000, // 72 hours (3 days)
  ASSET_CATCHUP_THRESHOLD_MS: 5 * 60 * 1000, // 5 minutes
} as const;
