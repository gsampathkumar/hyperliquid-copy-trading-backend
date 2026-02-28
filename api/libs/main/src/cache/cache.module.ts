import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisService } from '@hyperliquid-api/main/cache/redis.service';
import { UtilModule } from '@hyperliquid-api/main/shared/modules/util/util.module';

@Global()
@Module({
  imports: [ConfigModule, UtilModule],
  providers: [RedisService],
  exports: [RedisService],
})
export class CacheModule {}
