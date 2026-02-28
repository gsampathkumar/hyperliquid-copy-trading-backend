import {
  Module,
} from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'

import { CryptoModule } from '@hyperliquid-api/main/shared/modules/crypto/crypto.module'
import { UtilModule } from '@hyperliquid-api/main/shared/modules/util/util.module'
import { AuthModule } from '@hyperliquid-api/main/auth/auth.module'
import { InstrumentInterceptor } from '@hyperliquid-api/main/shared/interceptors/instrument.interceptor'
import { LoggerService } from '@hyperliquid-api/main/shared/modules/util/logger.service'
import { UsersModule } from '@hyperliquid-api/main/users/users.module'
import { HealthController } from '@hyperliquid-api/main/health/health.controller'
import { CacheModule } from '@hyperliquid-api/main/cache/cache.module'
import { SessionValidationGuard } from '@hyperliquid-api/main/shared/guards/session-validation.guard'
import { HyperliquidModule } from '@hyperliquid-api/main/hyperliquid/hyperliquid.module'
import { RateLimiterModule } from '@hyperliquid-api/main/shared/modules/rate-limiter/rate-limiter.module'
import { TradersModule } from '@hyperliquid-api/main/traders/traders.module'

// Environment validation function
const validateEnvironment = (config: Record<string, unknown>) => {
  const requiredEnvVars = [
    'MACHINE',
    'JWT_SECRET',
    'MONGO_URI',
    'AUTH_MONGO_URI',
    'REDIS_HOST',
    'REDIS_PORT',
    'LOG_LEVEL',
    'PORT',
    'SERVICE_NAME',
    'ENVIRONMENT',
    'SHARED_PREFIX',
  ];

  const missingVars = requiredEnvVars.filter(envVar => config[envVar] === undefined || config[envVar] === null);

  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }

  return config;
};

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: '../.env',  // Root .env shared with analytics
      validate: validateEnvironment
    }),
    CacheModule,
    // Main database for hyperliquid analytics data
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        return {
          uri: configService.get('MONGO_URI'),
          autoIndex: true,
          connectionFactory: (connection) => {
            connection.set('defaultTransactionOptions', {
              readPreference: 'primary',
              readConcern: { level: 'majority' },
              writeConcern: { w: 'majority' }
            });
            return connection;
          },
        }
      },
      inject: [ConfigService],
    }),
    // Auth database for user lookups (shared with core-exchange-api)
    MongooseModule.forRootAsync({
      connectionName: 'auth',
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        return {
          uri: configService.get('AUTH_MONGO_URI'),
          autoIndex: false,
        }
      },
      inject: [ConfigService],
    }),
    CryptoModule,
    UtilModule,
    AuthModule,
    UsersModule,
    HyperliquidModule,
    RateLimiterModule,
    TradersModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: SessionValidationGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: InstrumentInterceptor,
      inject: [LoggerService]
    },
  ],
})
export class AppModule {}
