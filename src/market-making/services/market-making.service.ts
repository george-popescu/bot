/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';
import { LoggingService } from '../../logging/logging.service';
import { MexcApiService } from '../../mexc/services/mexc-api.service';
import { PancakeSwapService } from '../../pancakeswap/services/pancakeswap.service';
import { MexcNativeHttpService } from '../../mexc/services/mexc-native-http.service';

export enum MarketMakingStrategy {
  BALANCED = 'BALANCED', // Ordine echilibrate BUY/SELL
  BUY_ONLY = 'BUY_ONLY', // Doar ordine de cumpărare (accumulate)
  SELL_ONLY = 'SELL_ONLY', // Doar ordine de vânzare (distribute)
  ACCUMULATE = 'ACCUMULATE', // Mai multe BUY, puține SELL (acumulare strategică)
  DISTRIBUTE = 'DISTRIBUTE', // Mai multe SELL, puține BUY (distribuire strategică)
}

export interface MarketMakingConfig {
  enabled: boolean;
  exchange: 'MEXC' | 'PANCAKESWAP' | 'BOTH';
  spread: number; // percentage
  orderSize: number; // ILMT amount
  maxOrders: number; // maximum active orders per side
  refreshInterval: number; // seconds
  priceOffset: number; // percentage from mid price
  levels: number; // număr de niveluri pe fiecare parte
  levelDistance: number; // distanță între niveluri (procent)
  strategy: MarketMakingStrategy; // strategia de market making
  buyRatio?: number; // ratio pentru BUY orders (0-1) în strategii asimetrice
  sellRatio?: number; // ratio pentru SELL orders (0-1) în strategii asimetrice
}

export interface ActiveOrder {
  id: string; // clientOrderId sau orderId ca string
  orderId: string; // orderId de la MEXC (poate fi string sau number)
  exchange: 'MEXC' | 'PANCAKESWAP';
  side: 'BUY' | 'SELL';
  price: number;
  amount: number;
  timestamp: Date;
}

@Injectable()
export class MarketMakingService {
  private isRunning = false;
  private activeOrders: ActiveOrder[] = [];
  private intervalId: NodeJS.Timeout | null = null;
  private lastPrice: number | null = null;

  private readonly config: MarketMakingConfig;

  constructor(
    private readonly configService: ConfigService,
    private readonly loggingService: LoggingService,
    private readonly mexcApiService: MexcApiService,
    private readonly pancakeSwapService: PancakeSwapService,
    private readonly mexcNativeHttpService: MexcNativeHttpService,
  ) {
    const mmConfig = this.configService.marketMakingConfig;
    this.config = {
      enabled: mmConfig.enabled,
      exchange: mmConfig.exchange,
      spread: mmConfig.spread,
      orderSize: mmConfig.orderSize,
      maxOrders: mmConfig.maxOrders,
      refreshInterval: mmConfig.refreshInterval,
      priceOffset: mmConfig.priceOffset,
      levels: typeof mmConfig.levels === 'number' ? mmConfig.levels : 5,
      levelDistance:
        typeof mmConfig.levelDistance === 'number' ? mmConfig.levelDistance : 1,
      strategy: mmConfig.strategy || MarketMakingStrategy.BALANCED,
      buyRatio: mmConfig.buyRatio || 1.0,
      sellRatio: mmConfig.sellRatio || 1.0,
    };
  }

  /**
   * Start market making
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.loggingService.warn('Market making is already running');
      return;
    }

    if (!this.config.enabled) {
      this.loggingService.warn('Market making is disabled in configuration');
      return;
    }

    // Debug: log MEXC config FIRST
    this.loggingService.info('🔧 MEXC Config for debugging', {
      mexcApiKey: this.configService.mexcApiKey
        ? `${this.configService.mexcApiKey.substring(0, 8)}...`
        : 'NOT SET',
      mexcSecretKey: this.configService.mexcSecretKey
        ? `${this.configService.mexcSecretKey.substring(0, 8)}...`
        : 'NOT SET',
      mexcBaseUrl: this.configService.mexcBaseUrl,
    });

    this.loggingService.info('🏪 Starting Market Making Bot', {
      component: 'MarketMakingService',
      config: this.config,
    });

    this.isRunning = true;
    await this.runMarketMaking();
    // Set up periodic refresh
    this.intervalId = setInterval(() => {
      if (this.isRunning) {
        this.runMarketMaking().catch((error) => {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          this.loggingService.error('Error in market making cycle', error);
        });
      }
    }, this.config.refreshInterval * 1000);
  }

  /**
   * Stop market making
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      this.loggingService.warn('Market making is not running');
      return;
    }

    this.loggingService.info('🛑 Stopping Market Making Bot');
    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // Cancel all active orders
    await this.cancelAllOrders();
  }

  /**
   * Main market making logic
   */
  private async runMarketMaking(): Promise<void> {
    try {
      this.loggingService.info('🔄 Running market making cycle');
      // Get current market prices - use same logic as arbitrage bot
      const mexcBookTicker =
        await this.mexcApiService.getBookTicker('ILMTUSDT');
      const mexcBidPrice = parseFloat(mexcBookTicker.bidPrice);
      const mexcAskPrice = parseFloat(mexcBookTicker.askPrice);
      const mexcMidPrice = (mexcBidPrice + mexcAskPrice) / 2;
      // Dacă prețul nu s-a schimbat semnificativ, nu facem nimic
      if (
        this.lastPrice &&
        Math.abs(mexcMidPrice - this.lastPrice) / this.lastPrice < 0.0001
      ) {
        this.loggingService.info(
          '⏸️ No significant price change, skipping market making cycle',
          {
            lastPrice: this.lastPrice,
            currentPrice: mexcMidPrice,
          },
        );
        return;
      }
      this.lastPrice = mexcMidPrice;
      // For now, focus on MEXC market making
      if (this.config.exchange === 'MEXC' || this.config.exchange === 'BOTH') {
        await this.runMexcMarketMaking(mexcMidPrice);
      }
      this.loggingService.info('✅ Market making cycle completed', {
        activeOrders: this.activeOrders.length,
        mexcMidPrice,
        mexcBidPrice,
        mexcAskPrice,
      });
    } catch (error) {
      this.loggingService.error(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Run market making on MEXC
   */
  private async runMexcMarketMaking(currentPrice: number): Promise<void> {
    // 1. PRIMUL PAS: Fetch open orders from MEXC
    const openOrders = await this.mexcApiService.getOpenOrders('ILMTUSDT');
    // 2. Transform to ActiveOrder format
    this.activeOrders = openOrders.map((order) => ({
      id: order.clientOrderId || order.orderId.toString(),
      orderId: order.orderId.toString(), // Păstrăm ca string
      exchange: 'MEXC',
      side: order.side as 'BUY' | 'SELL',
      price: parseFloat(order.price),
      amount: parseFloat(order.origQty),
      timestamp: new Date(order.time),
    }));

    // 3. Split by side
    const buyOrders = this.activeOrders.filter((o) => o.side === 'BUY');
    const sellOrders = this.activeOrders.filter((o) => o.side === 'SELL');

    this.loggingService.info(`📋 Current orders status`, {
      totalOrders: this.activeOrders.length,
      buyOrders: buyOrders.length,
      sellOrders: sellOrders.length,
      currentPrice,
    });

    // 4. Calculez ordinele necesare pe baza strategiei
    const { buyOrdersNeeded, sellOrdersNeeded } = this.calculateOrdersNeeded(
      buyOrders.length,
      sellOrders.length,
    );

    this.loggingService.info(`📋 Strategy: ${this.config.strategy}`, {
      totalOrders: this.activeOrders.length,
      buyOrders: buyOrders.length,
      sellOrders: sellOrders.length,
      buyOrdersNeeded,
      sellOrdersNeeded,
      currentPrice,
    });

    // 5. Dacă nu trebuie să plasez ordine, nu fac nimic
    if (buyOrdersNeeded === 0 && sellOrdersNeeded === 0) {
      this.loggingService.info('✅ Strategy satisfied, no new orders needed');
      return;
    }

    // 6. Plasez ordine conform strategiei
    const levels = this.config.levels;
    const levelDistance = this.config.levelDistance / 100;
    const orderSize = this.config.orderSize;

    // 7. BUY levels - conform strategiei
    let buyPlaced = 0;
    if (buyOrdersNeeded > 0) {
      for (
        let i = 1;
        i <= levels && buyOrders.length + buyPlaced < buyOrdersNeeded;
        i++
      ) {
        const price = parseFloat(
          (currentPrice * (1 - i * levelDistance)).toFixed(6),
        );

        // Verifică dacă există deja buy la acest preț
        const exists = buyOrders.some(
          (o) => Math.abs(o.price - price) < 0.00001,
        );
        if (!exists) {
          // Verifică balanța USDT
          const account = await this.mexcApiService.getAccount();
          const usdt = account.balances.find((b) => b.asset === 'USDT');
          if (usdt && parseFloat(usdt.free) >= price * orderSize) {
            await this.placeBuyOrder('MEXC', price, orderSize);
            buyPlaced++;
          } else {
            this.loggingService.warn(`Insufficient USDT for BUY @ ${price}`);
            break; // Stop trying to place more buy orders
          }
        }
      }
    }

    // 8. SELL levels - conform strategiei
    let sellPlaced = 0;
    if (sellOrdersNeeded > 0) {
      for (
        let i = 1;
        i <= levels && sellOrders.length + sellPlaced < sellOrdersNeeded;
        i++
      ) {
        const price = parseFloat(
          (currentPrice * (1 + i * levelDistance)).toFixed(6),
        );

        // Verifică dacă există deja sell la acest preț
        const exists = sellOrders.some(
          (o) => Math.abs(o.price - price) < 0.00001,
        );
        if (!exists) {
          // Verifică balanța ILMT
          const account = await this.mexcApiService.getAccount();
          const ilmt = account.balances.find((b) => b.asset === 'ILMT');
          if (ilmt && parseFloat(ilmt.free) >= orderSize) {
            await this.placeSellOrder('MEXC', price, orderSize);
            sellPlaced++;
          } else {
            this.loggingService.warn(`Insufficient ILMT for SELL @ ${price}`);
            break; // Stop trying to place more sell orders
          }
        }
      }
    }

    this.loggingService.info(
      `📊 MEXC Market Making: Strategy ${this.config.strategy} executed`,
      {
        existingBuyOrders: buyOrders.length,
        existingSellOrders: sellOrders.length,
        newBuyPlaced: buyPlaced,
        newSellPlaced: sellPlaced,
        currentPrice,
        levels,
        levelDistance,
      },
    );
  }

  /**
   * Calculează câte ordine sunt necesare pe fiecare parte conform strategiei
   */
  private calculateOrdersNeeded(
    currentBuyOrders: number,
    currentSellOrders: number,
  ): { buyOrdersNeeded: number; sellOrdersNeeded: number } {
    const maxOrders = this.config.maxOrders;
    const strategy = this.config.strategy;

    switch (strategy) {
      case MarketMakingStrategy.BUY_ONLY:
        return {
          buyOrdersNeeded: Math.max(0, maxOrders - currentBuyOrders),
          sellOrdersNeeded: 0,
        };

      case MarketMakingStrategy.SELL_ONLY:
        return {
          buyOrdersNeeded: 0,
          sellOrdersNeeded: Math.max(0, maxOrders - currentSellOrders),
        };

      case MarketMakingStrategy.ACCUMULATE:
        // 80% BUY, 20% SELL
        const buyTarget = Math.floor(maxOrders * 0.8);
        const sellTarget = Math.floor(maxOrders * 0.2);
        return {
          buyOrdersNeeded: Math.max(0, buyTarget - currentBuyOrders),
          sellOrdersNeeded: Math.max(0, sellTarget - currentSellOrders),
        };

      case MarketMakingStrategy.DISTRIBUTE:
        // 20% BUY, 80% SELL
        const buyTargetDist = Math.floor(maxOrders * 0.2);
        const sellTargetDist = Math.floor(maxOrders * 0.8);
        return {
          buyOrdersNeeded: Math.max(0, buyTargetDist - currentBuyOrders),
          sellOrdersNeeded: Math.max(0, sellTargetDist - currentSellOrders),
        };

      case MarketMakingStrategy.BALANCED:
      default:
        // Echilibrat 50/50
        return {
          buyOrdersNeeded: Math.max(0, maxOrders - currentBuyOrders),
          sellOrdersNeeded: Math.max(0, maxOrders - currentSellOrders),
        };
    }
  }

  /**
   * Place a buy order
   */
  private async placeBuyOrder(
    exchange: 'MEXC' | 'PANCAKESWAP',
    price: number,
    amount: number,
  ): Promise<void> {
    try {
      if (exchange === 'MEXC') {
        const order = await this.mexcApiService.placeOrder({
          symbol: 'ILMTUSDT',
          side: 'BUY',
          type: 'LIMIT',
          quantity: amount.toString(),
          price: price.toString(),
          timeInForce: 'GTC',
        });

        this.activeOrders.push({
          id: order.orderId.toString(),
          orderId: order.orderId.toString(), // Păstrăm ca string
          exchange: 'MEXC',
          side: 'BUY',
          price,
          amount,
          timestamp: new Date(),
        });

        this.loggingService.info(`🟢 BUY order placed on ${exchange}`, {
          orderId: order.orderId,
          price,
          amount,
        });
      }
    } catch (error) {
      this.loggingService.error(
        `Failed to place BUY order on ${exchange}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Place a sell order
   */
  private async placeSellOrder(
    exchange: 'MEXC' | 'PANCAKESWAP',
    price: number,
    amount: number,
  ): Promise<void> {
    try {
      if (exchange === 'MEXC') {
        const order = await this.mexcApiService.placeOrder({
          symbol: 'ILMTUSDT',
          side: 'SELL',
          type: 'LIMIT',
          quantity: amount.toString(),
          price: price.toString(),
          timeInForce: 'GTC',
        });

        this.activeOrders.push({
          id: order.orderId.toString(),
          orderId: order.orderId.toString(), // Păstrăm ca string
          exchange: 'MEXC',
          side: 'SELL',
          price,
          amount,
          timestamp: new Date(),
        });

        this.loggingService.info(`🔴 SELL order placed on ${exchange}`, {
          orderId: order.orderId,
          price,
          amount,
        });
      }
    } catch (error) {
      this.loggingService.error(
        `Failed to place SELL order on ${exchange}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Cancel orders that are too far from current price
   */
  private async cancelStaleOrders(currentPrice: number): Promise<void> {
    // DISABLED: Nu mai anulăm ordine automat
    // Doar dacă utilizatorul cere explicit sau dacă ordinele sunt foarte departe de preț
    const maxDeviation = 0.1; // 10% maximum deviation (foarte mare pentru a nu anula automat)

    const staleOrders = this.activeOrders.filter((order) => {
      const deviation = Math.abs(order.price - currentPrice) / currentPrice;
      return deviation > maxDeviation;
    });

    if (staleOrders.length > 0) {
      this.loggingService.warn(
        `Found ${staleOrders.length} orders very far from current price (${maxDeviation * 100}% deviation)`,
      );
      this.loggingService.info('Stale orders details', {
        currentPrice,
        maxDeviation,
        staleOrders: staleOrders.map((o) => ({
          orderId: o.orderId,
          price: o.price,
          side: o.side,
        })),
      });

      for (const order of staleOrders) {
        await this.cancelOrder(order);
      }
    }
  }

  /**
   * Cancel a specific order
   */
  private async cancelOrder(order: ActiveOrder): Promise<void> {
    try {
      this.loggingService.info(`