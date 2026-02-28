import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Trader, TraderDocument } from './schemas/trader.schema';
import { Fill, FillDocument } from './schemas/fill.schema';
import { TradersQueryDto, TraderSearchDto, TraderPositionsQueryDto, TraderTradesQueryDto } from './dto/traders-query.dto';
import { ExploreQueryDto, ExploreRowsQueryDto, BUCKET_BOUNDARIES } from './dto/explore-query.dto';
import { HyperliquidApiService } from '../hyperliquid/hyperliquid-api.service';
import { escapeRegex } from '../shared/utils/string-helpers';

@Injectable()
export class TradersService {
  constructor(
    @InjectModel(Trader.name) private traderModel: Model<TraderDocument>,
    @InjectModel(Fill.name) private fillModel: Model<FillDocument>,
    private hyperliquidApi: HyperliquidApiService,
  ) {}

  /**
   * Paginated trader list with optional search and sorting.
   */
  async findAll(query: TradersQueryDto) {
    const { page = 1, limit = 20, sortBy = 'allTimePnl', sortOrder = 'desc', search } = query;
    const skip = (page - 1) * limit;

    const filter: any = {};
    if (search) {
      const escaped = escapeRegex(search);
      if (search.startsWith('0x')) {
        filter.address = { $regex: `^${escaped}`, $options: 'i' };
      } else {
        filter.$or = [
          { displayName: { $regex: escaped, $options: 'i' } },
          { address: { $regex: escaped, $options: 'i' } },
        ];
      }
    }

    const sort: any = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

    const [traders, total] = await Promise.all([
      this.traderModel.find(filter).sort(sort).skip(skip).limit(limit).lean().exec(),
      this.traderModel.countDocuments(filter).exec(),
    ]);

    return {
      traders,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Autocomplete search by address or display name.
   */
  async search(query: TraderSearchDto) {
    const { q, limit = 10 } = query;
    const escaped = escapeRegex(q);

    let filter: any;
    if (q.startsWith('0x')) {
      filter = { address: { $regex: `^${escaped}`, $options: 'i' } };
    } else {
      filter = {
        $or: [
          { displayName: { $regex: escaped, $options: 'i' } },
          { address: { $regex: escaped, $options: 'i' } },
        ],
      };
    }

    return this.traderModel
      .find(filter)
      .sort({ accountValue: -1 })
      .limit(limit)
      .lean()
      .exec();
  }

  /**
   * Bucketed histogram for exploration.
   */
  async explore(query: ExploreQueryDto) {
    const { dimension } = query;
    const criteria = this.buildExploreCriteria(query);
    const boundaries = BUCKET_BOUNDARIES[dimension];

    if (!boundaries) {
      throw new NotFoundException(`Unknown dimension: ${dimension}`);
    }

    const pipeline: any[] = [];

    if (Object.keys(criteria).length > 0) {
      pipeline.push({ $match: criteria });
    }

    pipeline.push({
      $bucket: {
        groupBy: `$${dimension}`,
        boundaries,
        default: 'Other',
        output: {
          count: { $sum: 1 },
          avgPnl: { $avg: '$allTimePnl' },
          totalPnl: { $sum: '$allTimePnl' },
          avgAccountValue: { $avg: '$accountValue' },
          avgSharpe: { $avg: '$sharpeRatio' },
          avgWinRate: { $avg: '$winRate' },
          avgDrawdown: { $avg: '$maxDrawdownPercent' },
          avgKelly: { $avg: '$kellyFraction' },
          avgLeverage: { $avg: '$avgLeverage' },
        },
      },
    });

    const [buckets, totalCountResult] = await Promise.all([
      this.traderModel.aggregate(pipeline).exec(),
      this.traderModel.countDocuments(criteria).exec(),
    ]);

    return { buckets, totalCount: totalCountResult };
  }

  /**
   * Paginated rows matching explore criteria.
   */
  async exploreRows(query: ExploreRowsQueryDto) {
    const { page = 1, limit = 20, sortBy, sortOrder = 'desc', dimension } = query;
    const skip = (page - 1) * limit;
    const criteria = this.buildExploreCriteria(query);

    const sort: any = { [sortBy || dimension]: sortOrder === 'asc' ? 1 : -1 };

    const [traders, total] = await Promise.all([
      this.traderModel.find(criteria).sort(sort).skip(skip).limit(limit).lean().exec(),
      this.traderModel.countDocuments(criteria).exec(),
    ]);

    return {
      traders,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get single trader detail.
   */
  private validateAddress(address: string): string {
    const normalized = address.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
      throw new BadRequestException('Invalid Ethereum address format');
    }
    return normalized;
  }

  async getTrader(address: string) {
    const normalized = this.validateAddress(address);
    const trader = await this.traderModel
      .findOne({ address: normalized })
      .lean()
      .exec();

    if (!trader) {
      throw new NotFoundException(`Trader ${address} not found`);
    }

    return trader;
  }

  /**
   * Get trader's positions.
   * - status=open: live from Hyperliquid clearinghouseState API
   * - status=closed: reconstructed from stored fills (matching open/close directions)
   */
  async getTraderPositions(address: string, query: TraderPositionsQueryDto) {
    const normalized = this.validateAddress(address);
    const { status = 'open' } = query;

    if (status === 'open') {
      return this.getOpenPositions(normalized);
    }

    return this.getClosedPositions(normalized);
  }

  private async getOpenPositions(address: string) {
    const state = await this.hyperliquidApi.getClearinghouseState(address);

    if (!state || !state.assetPositions) {
      return { positions: [], status: 'open' };
    }

    const positions = state.assetPositions
      .map((ap: any) => ap.position)
      .filter((p: any) => p && Math.abs(parseFloat(p.szi || '0')) > 0)
      .map((p: any) => ({
        coin: p.coin,
        size: p.szi,
        entryPrice: p.entryPx,
        leverage: p.leverage ? p.leverage.value : null,
        leverageType: p.leverage ? p.leverage.type : null,
        liquidationPrice: p.liquidationPx,
        unrealizedPnl: p.unrealizedPnl,
        returnOnEquity: p.returnOnEquity,
        marginUsed: p.marginUsed,
        maxLeverage: p.maxLeverage,
        cumulativeFunding: p.cumFunding ? p.cumFunding.allTime : null,
      }));

    return { positions, status: 'open' };
  }

  /**
   * Reconstruct closed positions from stored fills by matching Open/Close directions.
   * Returns most recent closed positions first.
   */
  private async getClosedPositions(address: string) {
    // Fetch recent fills sorted ascending by time for reconstruction (limit to prevent OOM)
    const fills = await this.fillModel
      .find({ traderAddress: address.toLowerCase() })
      .sort({ time: 1 })
      .limit(10000)
      .lean()
      .exec();

    const closedPositions: any[] = [];
    // Track open state per coin
    const openState = new Map<string, { direction: string; openTime: number; entryPrice: number; size: number; leverage: string | null }>();

    for (const fill of fills) {
      const dir = (fill as any).dir || '';
      const coin = (fill as any).coin;
      const px = parseFloat((fill as any).px || '0');
      const sz = parseFloat((fill as any).sz || '0');

      if (dir.startsWith('Open')) {
        const direction = dir.includes('Long') ? 'long' : 'short';
        openState.set(coin, {
          direction,
          openTime: (fill as any).time,
          entryPrice: px,
          size: sz,
          leverage: null,
        });
      } else if (dir.startsWith('Close')) {
        const open = openState.get(coin);
        if (open) {
          const closedPnl = parseFloat((fill as any).closedPnl || '0');
          const fee = parseFloat((fill as any).fee || '0');
          const holdTimeMs = (fill as any).time - open.openTime;

          closedPositions.push({
            coin,
            direction: open.direction,
            entryPrice: String(open.entryPrice),
            exitPrice: String(px),
            size: String(open.size),
            closedPnl: String(closedPnl),
            fee: String(fee),
            netPnl: String(closedPnl - fee),
            openTime: open.openTime,
            closeTime: (fill as any).time,
            holdTimeMs,
            liquidation: (fill as any).liquidation || false,
          });

          // Check if fully closed
          const remaining = parseFloat((fill as any).startPosition || '0') - sz;
          if (Math.abs(remaining) < 0.0001) {
            openState.delete(coin);
          }
        }
      }
    }

    // Return most recent first
    closedPositions.reverse();

    return { positions: closedPositions, status: 'closed' };
  }

  /**
   * Get trader's trade history from stored fills.
   */
  async getTraderTrades(address: string, query: TraderTradesQueryDto) {
    const normalized = this.validateAddress(address);
    const { page = 1, limit = 20, coin } = query;
    const skip = (page - 1) * limit;

    const filter: any = { traderAddress: normalized };
    if (coin) filter.coin = coin;

    const [trades, total] = await Promise.all([
      this.fillModel.find(filter).sort({ time: -1 }).skip(skip).limit(limit).lean().exec(),
      this.fillModel.countDocuments(filter).exec(),
    ]);

    return {
      trades,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Build MongoDB criteria from explore query range filters.
   */
  private buildExploreCriteria(query: ExploreQueryDto): any {
    const criteria: any = {};

    const rangeFields = [
      'winRate', 'sharpeRatio', 'sortinoRatio', 'allTimePnl', 'accountValue',
      'maxDrawdownPercent', 'kellyFraction', 'profitFactor', 'avgLeverage',
      'totalVolume', 'totalTrades',
    ];

    for (const field of rangeFields) {
      const min = (query as any)[`${field}Min`];
      const max = (query as any)[`${field}Max`];

      if (min !== undefined || max !== undefined) {
        criteria[field] = {};
        if (min !== undefined) criteria[field].$gte = min;
        if (max !== undefined) criteria[field].$lte = max;
      }
    }

    if (query.traderStyle) {
      criteria.traderStyle = query.traderStyle;
    }

    return criteria;
  }
}
