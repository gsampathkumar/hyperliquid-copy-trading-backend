import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TraderDocument = Trader & Document;

const SHARED_PREFIX = process.env.SHARED_PREFIX || '';

@Schema({
  collection: SHARED_PREFIX ? `${SHARED_PREFIX}_hl_traders` : 'hl_traders',
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
})
export class Trader {
  // === Identity ===
  @Prop({ required: true, unique: true, index: true })
  address!: string;

  @Prop()
  displayName?: string;

  // === Portfolio data (from HL portfolio endpoint) ===
  @Prop({ type: Number, default: 0 })
  accountValue!: number;

  @Prop({ type: Number, default: 0 })
  allTimePnl!: number;

  @Prop({ type: Number, default: 0 })
  dayPnl!: number;

  @Prop({ type: Number, default: 0 })
  weekPnl!: number;

  @Prop({ type: Number, default: 0 })
  monthPnl!: number;

  @Prop({ type: Number, default: 0 })
  allTimeRoi!: number;

  // === Clearinghouse snapshot ===
  @Prop({ type: Number, default: 0 })
  marginUsed!: number;

  @Prop({ type: Number, default: 0 })
  withdrawable!: number;

  @Prop({ type: Number, default: 0 })
  openPositionCount!: number;

  @Prop({ type: Number, default: 0 })
  totalNotionalPosition!: number;

  // === Trade statistics (computed from fills) ===
  @Prop({ type: Number, default: 0 })
  totalTrades!: number;

  @Prop({ type: Number, default: 0 })
  totalVolume!: number;

  // === Computed performance metrics ===
  @Prop({ type: Number, default: 0 })
  winRate!: number;

  @Prop({ type: Number, default: null })
  sharpeRatio!: number | null;

  @Prop({ type: Number, default: null })
  sortinoRatio!: number | null;

  @Prop({ type: Number, default: null })
  maxDrawdown!: number | null;

  @Prop({ type: Number, default: null })
  maxDrawdownPercent!: number | null;

  @Prop({ type: Number, default: null })
  kellyFraction!: number | null;

  @Prop({ type: Number, default: null })
  profitFactor!: number | null;

  // === Trading characteristics ===
  @Prop({ type: Number, default: null })
  avgLeverage!: number | null;

  @Prop({ type: Number, default: null })
  avgHoldTimeMs!: number | null;

  @Prop({ type: String, default: null })
  traderStyle!: string | null; // 'scalper' | 'day_trader' | 'swing' | 'position'

  @Prop({ type: Number, default: null })
  fundingAlpha!: number | null; // Net funding earned vs market average

  @Prop({ type: Number, default: 0 })
  liquidationCount!: number;

  // === Timestamps ===
  @Prop({ type: Date })
  firstSeenAt!: Date;

  @Prop({ type: Date })
  lastSeenAt!: Date;

  @Prop({ type: Date })
  lastTradeAt?: Date;

  @Prop({ type: Date })
  traderProcessedAt?: Date;

  // === Backfill tracking ===
  @Prop({ type: Number, default: 0 })
  totalFillsIngested!: number;

  @Prop({ type: Date })
  fillsBackfilledFrom?: Date; // Earliest fill timestamp we have

  @Prop({ type: Boolean, default: false })
  fillsFullyBackfilled!: boolean; // True if we got all fills (didn't hit 10K API cap)

  // === Refresh scheduling ===
  @Prop({ type: Number, default: null })
  fillRate!: number | null; // Fills per hour (computed from stored fill timestamps)

  @Prop({ type: String, default: null })
  refreshTier!: string | null; // 'active' | 'recent' | 'stale'

  @Prop({ type: Date })
  nextRefreshAt?: Date; // When to next refresh this trader's data

  // === Leaderboard source data ===
  @Prop({ type: String })
  leaderboardRank?: string;

  @Prop({ type: String })
  leaderboardPnl?: string; // Raw string from leaderboard JSON

  // Mongoose timestamps
  createdAt!: Date;
  updatedAt!: Date;
}

export const TraderSchema = SchemaFactory.createForClass(Trader);

// Indexes for querying
TraderSchema.index({ address: 'text', displayName: 'text' });
TraderSchema.index({ allTimePnl: -1 });
TraderSchema.index({ accountValue: -1 });
TraderSchema.index({ winRate: -1 });
TraderSchema.index({ sharpeRatio: -1 });
TraderSchema.index({ totalVolume: -1 });
TraderSchema.index({ totalTrades: -1 });
TraderSchema.index({ traderProcessedAt: 1 });
TraderSchema.index({ lastTradeAt: -1 });
TraderSchema.index({ traderStyle: 1 });
TraderSchema.index({ nextRefreshAt: 1 });
