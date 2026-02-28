/**
 * Redis connection for BullMQ queues - API project version
 */

import Redis from 'ioredis';

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const REDIS_USERNAME = process.env.REDIS_USERNAME || undefined;

let queueConnection: Redis | null = null;

export function getQueueConnection(): Redis {
  if (!queueConnection) {
    queueConnection = new Redis({
      host: REDIS_HOST,
      port: REDIS_PORT,
      password: REDIS_PASSWORD,
      username: REDIS_USERNAME,
      maxRetriesPerRequest: null, // Required for BullMQ
      enableReadyCheck: false,
    });
  }
  return queueConnection;
}

export async function closeQueueConnection(): Promise<void> {
  if (queueConnection) {
    await queueConnection.quit();
    queueConnection = null;
  }
}
