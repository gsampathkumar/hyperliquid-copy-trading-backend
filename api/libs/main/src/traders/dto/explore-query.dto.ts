import { IsOptional, IsString, IsNumber, IsIn, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

const EXPLORE_DIMENSIONS = [
  'winRate', 'sharpeRatio', 'sortinoRatio', 'allTimePnl', 'accountValue',
  'maxDrawdownPercent', 'kellyFraction', 'profitFactor', 'avgLeverage',
  'totalVolume', 'totalTrades',
] as const;

export const BUCKET_BOUNDARIES: Record<string, number[]> = {
  winRate: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
  sharpeRatio: [-1e9, -1, 0, 0.5, 1, 1.5, 2, 2.5, 3, 1e9],
  sortinoRatio: [-1e9, -1, 0, 0.5, 1, 1.5, 2, 3, 5, 1e9],
  allTimePnl: [-1e12, -100000, -10000, -1000, 0, 1000, 10000, 100000, 1e6, 1e12],
  accountValue: [0, 1000, 5000, 10000, 50000, 100000, 500000, 1e6, 1e12],
  maxDrawdownPercent: [0, 5, 10, 25, 50, 75, 100],
  kellyFraction: [-1e9, 0, 0.05, 0.1, 0.15, 0.2, 0.25, 1e9],
  profitFactor: [0, 0.5, 1, 1.5, 2, 3, 5, 10, 1e9],
  avgLeverage: [0, 1, 2, 5, 10, 20, 50, 100, 1e9],
  totalVolume: [0, 1000, 10000, 100000, 1e6, 10e6, 100e6, 1e12],
  totalTrades: [0, 10, 50, 100, 500, 1000, 5000, 10000, 1e9],
};

export class ExploreQueryDto {
  @IsString()
  @IsIn(EXPLORE_DIMENSIONS)
  dimension!: string;

  // Range filters — all optional
  @IsOptional() @Type(() => Number) @IsNumber() winRateMin?: number;
  @IsOptional() @Type(() => Number) @IsNumber() winRateMax?: number;
  @IsOptional() @Type(() => Number) @IsNumber() sharpeRatioMin?: number;
  @IsOptional() @Type(() => Number) @IsNumber() sharpeRatioMax?: number;
  @IsOptional() @Type(() => Number) @IsNumber() sortinoRatioMin?: number;
  @IsOptional() @Type(() => Number) @IsNumber() sortinoRatioMax?: number;
  @IsOptional() @Type(() => Number) @IsNumber() allTimePnlMin?: number;
  @IsOptional() @Type(() => Number) @IsNumber() allTimePnlMax?: number;
  @IsOptional() @Type(() => Number) @IsNumber() accountValueMin?: number;
  @IsOptional() @Type(() => Number) @IsNumber() accountValueMax?: number;
  @IsOptional() @Type(() => Number) @IsNumber() maxDrawdownPercentMin?: number;
  @IsOptional() @Type(() => Number) @IsNumber() maxDrawdownPercentMax?: number;
  @IsOptional() @Type(() => Number) @IsNumber() kellyFractionMin?: number;
  @IsOptional() @Type(() => Number) @IsNumber() kellyFractionMax?: number;
  @IsOptional() @Type(() => Number) @IsNumber() profitFactorMin?: number;
  @IsOptional() @Type(() => Number) @IsNumber() profitFactorMax?: number;
  @IsOptional() @Type(() => Number) @IsNumber() avgLeverageMin?: number;
  @IsOptional() @Type(() => Number) @IsNumber() avgLeverageMax?: number;
  @IsOptional() @Type(() => Number) @IsNumber() totalVolumeMin?: number;
  @IsOptional() @Type(() => Number) @IsNumber() totalVolumeMax?: number;
  @IsOptional() @Type(() => Number) @IsNumber() totalTradesMin?: number;
  @IsOptional() @Type(() => Number) @IsNumber() totalTradesMax?: number;
  @IsOptional() @IsString() traderStyle?: string;
}

export class ExploreRowsQueryDto extends ExploreQueryDto {
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
  sortBy?: string;

  @IsOptional()
  @IsString()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
