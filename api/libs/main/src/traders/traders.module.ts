import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TradersController } from './traders.controller';
import { TradersService } from './traders.service';
import { Trader, TraderSchema } from './schemas/trader.schema';
import { Fill, FillSchema } from './schemas/fill.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Trader.name, schema: TraderSchema },
      { name: Fill.name, schema: FillSchema },
    ]),
  ],
  controllers: [TradersController],
  providers: [TradersService],
  exports: [TradersService],
})
export class TradersModule {}
