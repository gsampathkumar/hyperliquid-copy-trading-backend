import { Module, Global } from '@nestjs/common';
import { HyperliquidApiService } from './hyperliquid-api.service';

@Global()
@Module({
  providers: [HyperliquidApiService],
  exports: [HyperliquidApiService],
})
export class HyperliquidModule {}
