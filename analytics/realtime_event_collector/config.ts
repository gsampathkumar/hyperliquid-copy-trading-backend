/**
 * Configuration for Hyperliquid realtime event collector
 */

import '../common/env';

export function getMongoUri(): string {
  return process.env.MONGO_URI || 'mongodb://localhost:27017/hyperliquid_storage';
}

export function extractDatabaseFromUri(uri: string): string {
  const match = uri.match(/\/([^/?]+)(\?|$)/);
  return match ? match[1] : 'hyperliquid_storage';
}

export const MONGODB_CONFIG = {
  uri: getMongoUri(),
  database: extractDatabaseFromUri(getMongoUri()),
};
