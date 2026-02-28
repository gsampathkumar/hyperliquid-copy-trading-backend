import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type FillDocument = Fill & Document;

@Schema({
  collection: `${process.env.SHARED_PREFIX}_hl_fills`,
  timestamps: false,
})
export class Fill {
  @Prop({ required: true, index: true })
  traderAddress!: string;

  @Prop({ required: true, index: true })
  coin!: string;

  @Prop({ required: true })
  px!: string; // Price (decimal string from HL)

  @Prop({ required: true })
  sz!: string; // Size (decimal string from HL)

  @Prop({ required: true })
  side!: string; // 'B' (buy) or 'A' (sell/ask)

  @Prop({ required: true })
  time!: number; // Timestamp in ms

  @Prop()
  hash!: string; // Transaction hash

  @Prop({ type: Number })
  tid?: number; // Trade ID

  @Prop()
  closedPnl!: string; // Closed PnL for this fill (decimal string)

  @Prop()
  fee!: string; // Fee paid (decimal string)

  @Prop()
  oid?: number; // Order ID

  @Prop()
  dir?: string; // Direction context from HL: 'Open Long', 'Close Long', 'Open Short', 'Close Short'

  @Prop({ type: Boolean, default: false })
  crossed!: boolean; // Was this a taker (market) order

  @Prop()
  feeToken?: string;

  @Prop()
  startPosition?: string; // Position size before this fill

  @Prop({ type: Boolean, default: false })
  liquidation!: boolean; // Was this a liquidation fill

  // Source tracking
  @Prop({ required: true, default: 'rest' })
  source!: string; // 'rest' (backfill) or 'ws' (forward-fill from WebSocket trades)
}

export const FillSchema = SchemaFactory.createForClass(Fill);

// Compound indexes for efficient querying
FillSchema.index({ traderAddress: 1, time: -1 }); // Trader's fills sorted by time
FillSchema.index({ traderAddress: 1, coin: 1, time: -1 }); // Per-asset fills for a trader
FillSchema.index({ coin: 1, time: -1 }); // All fills for an asset
FillSchema.index({ hash: 1, tid: 1 }, { unique: true, sparse: true } as any); // Dedup
