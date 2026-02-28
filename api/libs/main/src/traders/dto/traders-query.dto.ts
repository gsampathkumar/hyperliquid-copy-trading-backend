import { IsOptional, IsString, IsNumber, IsIn, Min, Max } from 'class-validator';
import { Transform, Type } from 'class-transformer';

const SORTABLE_FIELDS = [
  'allTimePnl', 'accountValue', 'winRate', 'sharpeRatio', 'sortinoRatio',
  'maxDrawdownPercent', 'kellyFraction', 'profitFactor', 'totalTrades',
  'totalVolume', 'avgLeverage', 'lastTradeAt', 'dayPnl', 'weekPnl', 'monthPnl',
] as const;

export class TradersQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  @IsIn(SORTABLE_FIELDS)
  sortBy?: string = 'allTimePnl';

  @IsOptional()
  @IsString()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';

  @IsOptional()
  @IsString()
  search?: string;
}

export class TraderSearchDto {
  @IsString()
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50)
  limit?: number = 10;
}

export class TraderPositionsQueryDto {
  @IsOptional()
  @IsString()
  @IsIn(['open', 'closed'])
  status?: 'open' | 'closed' = 'open';
}

export class TraderTradesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  coin?: string;
}
