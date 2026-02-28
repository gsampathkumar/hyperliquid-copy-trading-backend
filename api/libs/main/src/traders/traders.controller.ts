import { Controller, Get, Param, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { TradersService } from './traders.service';
import { TradersQueryDto, TraderSearchDto, TraderPositionsQueryDto, TraderTradesQueryDto } from './dto/traders-query.dto';
import { ExploreQueryDto, ExploreRowsQueryDto } from './dto/explore-query.dto';

@Controller('v1/hl/traders')
export class TradersController {
  constructor(private readonly tradersService: TradersService) {}

  @Get()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async findAll(@Query() query: TradersQueryDto) {
    return this.tradersService.findAll(query);
  }

  @Get('search')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async search(@Query() query: TraderSearchDto) {
    return this.tradersService.search(query);
  }

  @Get('explore')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async explore(@Query() query: ExploreQueryDto) {
    return this.tradersService.explore(query);
  }

  @Get('explore/rows')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async exploreRows(@Query() query: ExploreRowsQueryDto) {
    return this.tradersService.exploreRows(query);
  }

  @Get(':address')
  async getTrader(@Param('address') address: string) {
    return this.tradersService.getTrader(address);
  }

  @Get(':address/positions')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async getTraderPositions(
    @Param('address') address: string,
    @Query() query: TraderPositionsQueryDto,
  ) {
    return this.tradersService.getTraderPositions(address, query);
  }

  @Get(':address/trades')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async getTraderTrades(
    @Param('address') address: string,
    @Query() query: TraderTradesQueryDto,
  ) {
    return this.tradersService.getTraderTrades(address, query);
  }
}
