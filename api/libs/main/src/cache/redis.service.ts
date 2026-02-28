import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { LoggerService } from '../shared/modules/util/logger.service';
import { EnvironmentEnum } from '../shared/enums/environment.enum';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private redis: Redis;
  private isConnected = false;
  private prefix: string;
  private reconnectInterval: ReturnType<typeof setInterval>;
  private disconnectedSince: number | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.prefix = this.configService.get('SHARED_PREFIX') || '';
  }

  async onModuleInit() {
    const redisHost = this.configService.get<string>('REDIS_HOST');
    const redisPort = this.configService.get<number>('REDIS_PORT');
    const redisUsername = this.configService.get<string>('REDIS_USERNAME');
    const redisPassword = this.configService.get<string>('REDIS_PASSWORD');

    this.redis = new Redis({
      host: redisHost,
      port: redisPort,
      username: redisUsername,
      password: redisPassword,
      tls: redisPassword ? { rejectUnauthorized: this.configService.get<string>('ENVIRONMENT') !== EnvironmentEnum.dev } : undefined,
      keepAlive: 10000,
      connectionName: `worker-${process.pid}`,
      retryStrategy: (times) => {
        if (times > 10) {
          this.logger.error('Max reconnection attempts reached', { subject: 'Redis retry strategy' });
          return null;
        }
        const delay = Math.min(times * 100, 3000);
        return delay;
      },
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      enableOfflineQueue: true,
      lazyConnect: false,
      connectTimeout: 10000,
    });

    this.redis.on('connect', () => {
      this.isConnected = true;
      if (this.disconnectedSince !== null) {
        const downtime = Date.now() - this.disconnectedSince;
        this.logger.info(`Redis reconnected after ${this._formatDowntime(downtime)} (Worker PID: ${process.pid})`);
        this.disconnectedSince = null;
      } else {
        this.logger.debug(`Redis connected (Worker PID: ${process.pid})`);
      }
    });

    this.redis.on('ready', () => {
      this.logger.debug(`Redis ready (Worker PID: ${process.pid})`);
    });

    this.redis.on('error', (error) => {
      if (this.isConnected) {
        this.disconnectedSince = Date.now();
      }
      this.isConnected = false;
      this.logger.error(`Redis error: ${error.message}`, { subject: 'Redis connection error' });
    });

    this.redis.on('close', () => {
      if (this.isConnected) {
        this.disconnectedSince = Date.now();
      }
      this.isConnected = false;
      this.logger.debug('Redis connection closed');
    });

    this.redis.on('reconnecting', (delay) => {
      this.logger.debug(`Reconnecting to Redis in ${delay}ms...`);
    });

    this.redis.on('end', () => {
      if (this.isConnected) {
        this.disconnectedSince = Date.now();
      }
      this.isConnected = false;
      this.logger.debug('Redis connection ended');
    });

    this.reconnectInterval = setInterval(() => {
      if (!this.isConnected && this.redis.status !== 'connecting' && this.redis.status !== 'reconnecting') {
        const now = Date.now();

        if (this.disconnectedSince === null) {
          this.disconnectedSince = now;
        }

        const downtime = now - this.disconnectedSince;
        this.logger.warn(
          `Redis disconnected for ${this._formatDowntime(downtime)}, attempting to reconnect...`
        );

        this.redis.connect().catch((err) => {
          this.logger.error(`Manual reconnect failed: ${err.message}`, {subject:'Redis reconnect'});
        });
      }
    }, 30000);
  }

  private _formatDowntime(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  getKeyWithPrefix(key: string): string {
    return this.prefix ? `${this.prefix}:${key}` : key;
  }

  async get<T>(key: string): Promise<T | undefined> {
    try {
      if (!this.isConnected) {
        this.logger.warn('Redis not connected, skipping get operation');
        return undefined;
      }
      const prefixedKey = this.getKeyWithPrefix(key);
      const value = await this.redis.get(prefixedKey);
      if (!value) {
        return undefined;
      }
      return JSON.parse(value) as T;
    } catch (error) {
      this.logger.error(`Error getting key ${key}: ${error.message}`, { subject: 'Redis get' });
      return undefined;
    }
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    try {
      if (!this.isConnected) {
        this.logger.warn('Redis not connected, skipping set operation');
        return;
      }
      const prefixedKey = this.getKeyWithPrefix(key);
      const serialized = JSON.stringify(value);
      if (ttlMs) {
        await this.redis.set(prefixedKey, serialized, 'PX', ttlMs);
      } else {
        await this.redis.set(prefixedKey, serialized);
      }
    } catch (error) {
      this.logger.error(`Error setting key ${key}: ${error.message}`, { subject: 'Redis set' });
    }
  }

  async delete(key: string): Promise<void> {
    try {
      if (!this.isConnected) {
        this.logger.warn('Redis not connected, skipping delete operation');
        return;
      }
      const prefixedKey = this.getKeyWithPrefix(key);
      await this.redis.del(prefixedKey);
    } catch (error) {
      this.logger.error(`Error deleting key ${key}: ${error.message}`, { subject: 'Redis delete' });
    }
  }

  async onModuleDestroy() {
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.logger.debug('Redis reconnection interval cleared');
    }

    if (this.redis) {
      try {
        await this.redis.quit();
        this.logger.info('Redis connection closed gracefully');
      } catch (error) {
        this.logger.error(`Error closing Redis connection: ${error.message}`, { subject: 'Redis destroy' });
      }
    }
  }

  getRedis(): Redis {
    return this.redis;
  }
}
