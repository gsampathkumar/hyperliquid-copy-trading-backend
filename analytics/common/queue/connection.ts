/**
 * Redis/BullMQ connection setup for Hyperliquid analytics
 */

import '../env'; // Ensure environment is loaded before reading process.env
import Redis from 'ioredis';
import logger from '../logger';

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const REDIS_USERNAME = process.env.REDIS_USERNAME || undefined;

export function createRedisConnection(): Redis {
  const connection = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    password: REDIS_PASSWORD,
    username: REDIS_USERNAME,
    maxRetriesPerRequest: null, // Required for BullMQ
    enableReadyCheck: false,
    retryStrategy: (times: number) => {
      if (times > 10) {
        logger.error(`[Redis] Max reconnection attempts reached (${times})`);
        return null;
      }
      const delay = Math.min(times * 500, 5000);
      logger.warn(`[Redis] Reconnecting in ${delay}ms (attempt ${times})`);
      return delay;
    },
  });

  connection.on('connect', () => {
    logger.info(`[Redis] Connected to ${REDIS_HOST}:${REDIS_PORT}`);
  });

  connection.on('error', (err) => {
    logger.error(`[Redis] Connection error: ${err.message}`);
  });

  connection.on('close', () => {
    logger.warn('[Redis] Connection closed');
  });

  return connection;
}

// Singleton connection for queues (producers)
let queueConnection: Redis | null = null;

export function getQueueConnection(): Redis {
  if (!queueConnection) {
    queueConnection = createRedisConnection();
  }
  return queueConnection;
}

export async function closeQueueConnection(): Promise<void> {
  if (queueConnection) {
    await queueConnection.quit();
    queueConnection = null;
    logger.info('[Redis] Queue connection closed');
  }
}

// Test Redis connectivity
export async function testRedisConnection(): Promise<boolean> {
  try {
    const conn = getQueueConnection();
    const pong = await conn.ping();
    logger.info(`[Redis] Connection test: ${pong}`);
    return pong === 'PONG';
  } catch (error) {
    logger.error(`[Redis] Connection test failed: ${error}`);
    return false;
  }
}
