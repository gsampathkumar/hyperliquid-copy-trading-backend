/**
 * MongoDB Storage (Singleton)
 *
 * Database operations for the Hyperliquid analytics pipeline.
 * This is the ONLY class that should use MongoClient directly.
 */

import { MongoClient, Db, Collection, AnyBulkWriteOperation } from 'mongodb';
import logger from './logger';

const SHARED_PREFIX = process.env.SHARED_PREFIX || '';
export const collectionName = (name: string): string => SHARED_PREFIX ? `${SHARED_PREFIX}_${name}` : name;

function getMongoUri(): string {
  return process.env.MONGO_URI || 'mongodb://localhost:27017/hyperliquid_storage';
}

function getDatabaseName(): string {
  const uri = getMongoUri();
  const match = uri.match(/\/([^/?]+)(\?|$)/);
  return match ? match[1] : 'hyperliquid_storage';
}

export class Storage {
  private static instance: Storage | null = null;
  private client: MongoClient;
  private db: Db | null = null;
  private isConnected = false;

  private constructor() {
    this.client = new MongoClient(getMongoUri());
  }

  static getInstance(): Storage {
    if (!Storage.instance) {
      Storage.instance = new Storage();
    }
    return Storage.instance;
  }

  async connect(): Promise<void> {
    if (this.isConnected) return;

    try {
      await this.client.connect();
      this.db = this.client.db(getDatabaseName());
      this.isConnected = true;
      logger.info(`[Storage] Connected to MongoDB database: ${getDatabaseName()}`);

      // Ensure indexes
      await this.ensureIndexes();
    } catch (error) {
      logger.error(`[Storage] Failed to connect to MongoDB: ${error}`);
      throw error;
    }
  }

  getDb(): Db {
    if (!this.db) {
      throw new Error('Storage not connected. Call connect() first.');
    }
    return this.db;
  }

  getClient(): MongoClient {
    return this.client;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.isConnected = false;
      logger.info('[Storage] MongoDB connection closed');
    }
  }

  // === Collection accessors ===

  traders(): Collection {
    return this.getDb().collection(collectionName('hl_traders'));
  }

  fills(): Collection {
    return this.getDb().collection(collectionName('hl_fills'));
  }

  trades(): Collection {
    return this.getDb().collection(collectionName('hl_trades'));
  }

  assets(): Collection {
    return this.getDb().collection(collectionName('hl_assets'));
  }

  fundingHistory(): Collection {
    return this.getDb().collection(collectionName('hl_funding_history'));
  }

  checkpoints(): Collection {
    return this.getDb().collection(collectionName('hl_checkpoints'));
  }

  // === Trader operations ===

  async upsertTrader(address: string, data: Record<string, any>): Promise<void> {
    await this.traders().updateOne(
      { address: address.toLowerCase() },
      {
        $set: { ...data, address: address.toLowerCase() },
        $setOnInsert: { firstSeenAt: new Date() },
      },
      { upsert: true },
    );
  }

  async bulkUpsertTraders(traders: Array<{ address: string; data: Record<string, any> }>): Promise<void> {
    if (traders.length === 0) return;

    const ops: AnyBulkWriteOperation<any>[] = traders.map(t => ({
      updateOne: {
        filter: { address: t.address.toLowerCase() },
        update: {
          $set: { ...t.data, address: t.address.toLowerCase() },
          $setOnInsert: { firstSeenAt: new Date() },
        },
        upsert: true,
      },
    }));

    await this.traders().bulkWrite(ops, { ordered: false });
  }

  async getTrader(address: string): Promise<any | null> {
    return this.traders().findOne({ address: address.toLowerCase() });
  }

  async markTraderProcessed(address: string): Promise<void> {
    await this.traders().updateOne(
      { address: address.toLowerCase() },
      { $set: { traderProcessedAt: new Date() } },
    );
  }

  async getTradersNeedingRefresh(maxAgeMs: number, limit: number = 100): Promise<any[]> {
    const cutoff = new Date(Date.now() - maxAgeMs);
    return this.traders().find({
      $or: [
        { traderProcessedAt: { $lt: cutoff } },
        { traderProcessedAt: { $exists: false } },
      ],
    })
      .sort({ traderProcessedAt: 1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Get traders whose scheduled refresh time has passed.
   * Used by the adaptive refresh scheduler.
   */
  async getTradersNeedingScheduledRefresh(limit: number = 100): Promise<any[]> {
    const now = new Date();
    return this.traders().find({
      $or: [
        { nextRefreshAt: { $lte: now } },
        { nextRefreshAt: { $exists: false } },
      ],
    })
      .sort({ nextRefreshAt: 1 })
      .limit(limit)
      .toArray();
  }

  // === Fill operations ===

  async bulkInsertFills(fills: any[]): Promise<{ inserted: number; duplicates: number }> {
    if (fills.length === 0) return { inserted: 0, duplicates: 0 };

    // Use unordered insert to skip duplicates (hash+tid unique index)
    try {
      const result = await this.fills().insertMany(fills, { ordered: false });
      return { inserted: result.insertedCount, duplicates: 0 };
    } catch (error: any) {
      // BulkWriteError with duplicate key errors is expected
      if (error.code === 11000 || error.writeErrors) {
        const inserted = error.result?.nInserted || error.insertedCount || 0;
        const duplicates = fills.length - inserted;
        return { inserted, duplicates };
      }
      throw error;
    }
  }

  async getTraderFills(address: string, limit: number = 2000, skip: number = 0): Promise<any[]> {
    return this.fills().find({ traderAddress: address.toLowerCase() })
      .sort({ time: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();
  }

  async getTraderFillCount(address: string): Promise<number> {
    return this.fills().countDocuments({ traderAddress: address.toLowerCase() });
  }

  async getLatestFillTime(address: string): Promise<number | null> {
    const latest = await this.fills()
      .find({ traderAddress: address.toLowerCase() })
      .sort({ time: -1 })
      .limit(1)
      .toArray();
    return latest.length > 0 ? latest[0].time : null;
  }

  // === Checkpoint operations (for resumable bootstrap) ===

  async getCheckpoint(key: string): Promise<any | null> {
    return this.checkpoints().findOne({ key });
  }

  async setCheckpoint(key: string, data: Record<string, any>): Promise<void> {
    await this.checkpoints().updateOne(
      { key },
      { $set: { ...data, key, updatedAt: new Date() } },
      { upsert: true },
    );
  }

  // === Index management ===

  private async ensureIndexes(): Promise<void> {
    try {
      // Trader indexes
      await this.traders().createIndex({ address: 1 }, { unique: true });
      await this.traders().createIndex({ allTimePnl: -1 });
      await this.traders().createIndex({ accountValue: -1 });
      await this.traders().createIndex({ traderProcessedAt: 1 });
      await this.traders().createIndex({ lastTradeAt: -1 });
      await this.traders().createIndex({ nextRefreshAt: 1 });

      // Fill indexes
      await this.fills().createIndex({ traderAddress: 1, time: -1 });
      await this.fills().createIndex({ coin: 1, time: -1 });
      await this.fills().createIndex({ hash: 1, tid: 1 }, { unique: true, sparse: true });

      // Trade indexes (raw market trades from WebSocket)
      await this.trades().createIndex({ coin: 1, time: -1 });
      await this.trades().createIndex({ hash: 1, tid: 1 }, { unique: true, sparse: true });

      // Asset indexes
      await this.assets().createIndex({ name: 1 }, { unique: true });
      await this.assets().createIndex({ lastUpdatedAt: 1 });
      await this.assets().createIndex({ dayVolume: -1 });
      await this.assets().createIndex({ openInterest: -1 });

      // Funding history indexes
      await this.fundingHistory().createIndex({ coin: 1, timestamp: -1 });
      await this.fundingHistory().createIndex({ timestamp: -1 });

      // Checkpoint
      await this.checkpoints().createIndex({ key: 1 }, { unique: true });

      logger.info('[Storage] Indexes ensured');
    } catch (error) {
      logger.warn(`[Storage] Index creation warning (may already exist): ${error}`);
    }
  }
}

export function getStorage(): Storage {
  return Storage.getInstance();
}
