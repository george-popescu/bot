/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';
import { LoggingService } from '../../logging/logging.service';
import { MexcApiService } from '../../mexc/services/mexc-api.service';
import { PancakeSwapService } from '../../pancakeswap/services/pancakeswap.service';
import {
  formatMexcQuantity,
  formatMexcPrice,
} from '../../mexc/utils/mexc-formatting.utils';

import * as fs from 'fs';
import * as path from 'path';

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
  maxRebalanceDistance?: number; // distanța maximă de la preț înainte de rebalansare (procent)
}

export interface ActiveOrder {
  id: string; // clientOrderId sau orderId ca string
  orderId: string; // orderId de la MEXC (poate fi string sau number)
  exchange: 'MEXC' | 'PANCAKESWAP';
  side: 'BUY' | 'SELL';
  price: number;
  amount: number;
  timestamp: Date;
  lastChecked?: Date; // When this order was last verified on exchange
}

export interface ExecutedOrder {
  orderId: string;
  exchange: 'MEXC' | 'PANCAKESWAP';
  side: 'BUY' | 'SELL';
  price: number;
  amount: number;
  executedAt: Date;
  replacementPlaced: boolean; // Whether we've placed a replacement order
}

@Injectable()
export class MarketMakingService {
  private isRunning = false;
  private activeOrders: ActiveOrder[] = [];
  private executedOrders: ExecutedOrder[] = [];
  private intervalId: NodeJS.Timeout | null = null;
  private lastPrice: number | null = null;
  private lastOrderCount = 0; // Track order count changes

  private readonly config: MarketMakingConfig;
  private readonly debugLogFile: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly loggingService: LoggingService,
    private readonly mexcApiService: MexcApiService,
    private readonly pancakeSwapService: PancakeSwapService,
  ) {
    const mmConfig = this.configService.marketMakingConfig;
    this.config = {
      enabled: mmConfig.enabled !== undefined ? mmConfig.enabled : true,
      exchange: mmConfig.exchange || 'MEXC',
      spread: mmConfig.spread || 0.5,
      orderSize: mmConfig.orderSize || 100,
      maxOrders: mmConfig.maxOrders || 8,
      refreshInterval: mmConfig.refreshInterval || 30,
      priceOffset: mmConfig.priceOffset || 0,
      levels: mmConfig.levels || 8,
      levelDistance: mmConfig.levelDistance || 0.5,
      strategy: mmConfig.strategy || MarketMakingStrategy.BALANCED,
      buyRatio: mmConfig.buyRatio || 1.0,
      sellRatio: mmConfig.sellRatio || 1.0,
      maxRebalanceDistance: mmConfig.maxRebalanceDistance || 5.0, // 5% default
    };

    // Initialize debug log file
    this.debugLogFile = path.join(
      process.cwd(),
      'logs',
      'market-making-debug.log',
    );
    this.ensureLogDirectory();
  }

  private ensureLogDirectory(): void {
    const logDir = path.dirname(this.debugLogFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  private writeDebugLog(message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      message,
      data: data || null,
    };

    const logLine = JSON.stringify(logEntry) + '\n';

    try {
      fs.appendFileSync(this.debugLogFile, logLine);
    } catch (error) {
      console.error('Failed to write debug log:', error);
    }
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
    // 1. SINCRONIZARE COMPLETĂ: Fetch open orders from MEXC
    const openOrders = await this.mexcApiService.getOpenOrders('ILMTUSDT');

    // 1.1. Detect executed orders before synchronization
    await this.detectExecutedOrders(openOrders);

    // 2. Log diferențele pentru debugging
    const localOrderIds = this.activeOrders.map((o) => o.orderId);
    const mexcOrderIds = openOrders.map((o) => o.orderId.toString());
    const missingOnMexc = localOrderIds.filter(
      (id) => !mexcOrderIds.includes(id),
    );
    const newOnMexc = mexcOrderIds.filter((id) => !localOrderIds.includes(id));

    if (missingOnMexc.length > 0 || newOnMexc.length > 0) {
      this.loggingService.info(
        '📊 Order synchronization differences detected',
        {
          localOrders: localOrderIds.length,
          mexcOrders: mexcOrderIds.length,
          missingOnMexc: missingOnMexc.length,
          newOnMexc: newOnMexc.length,
          missingOrderIds: missingOnMexc,
          newOrderIds: newOnMexc,
        },
      );

      this.writeDebugLog('ORDER_SYNC_DIFFERENCE', {
        localOrderIds,
        mexcOrderIds,
        missingOnMexc,
        newOnMexc,
      });
    }

    // 3. Transform to ActiveOrder format (ALWAYS sync with MEXC truth)
    this.activeOrders = openOrders.map((order) => ({
      id: order.clientOrderId || order.orderId.toString(),
      orderId: order.orderId.toString(), // Păstrăm ca string
      exchange: 'MEXC',
      side: order.side as 'BUY' | 'SELL',
      price: parseFloat(order.price),
      amount: parseFloat(order.origQty),
      timestamp: new Date(order.time),
    }));

    // 4. Rebalansez ordinele prea departe de preț (doar pe ordine care chiar există DUPĂ sincronizare)
    if (this.activeOrders.length > 0) {
      await this.rebalanceOrders(currentPrice);
    } else {
      this.loggingService.info('No orders to rebalance after synchronization');
    }

    // 5. Place strategic replacements for executed orders
    await this.placeStrategicReplacements(currentPrice);

    // 6. Re-fetch orders după rebalansare pentru sincronizare finală
    const refreshedOrders = await this.mexcApiService.getOpenOrders('ILMTUSDT');
    this.activeOrders = refreshedOrders.map((order) => ({
      id: order.clientOrderId || order.orderId.toString(),
      orderId: order.orderId.toString(),
      exchange: 'MEXC',
      side: order.side as 'BUY' | 'SELL',
      price: parseFloat(order.price),
      amount: parseFloat(order.origQty),
      timestamp: new Date(order.time),
      lastChecked: new Date(),
    }));

    // 7. Split by side
    const buyOrders = this.activeOrders.filter((o) => o.side === 'BUY');
    const sellOrders = this.activeOrders.filter((o) => o.side === 'SELL');

    this.loggingService.info(`📋 Current orders status`, {
      totalOrders: this.activeOrders.length,
      buyOrders: buyOrders.length,
      sellOrders: sellOrders.length,
      currentPrice,
    });

    // 8. Calculez ordinele necesare pe baza strategiei
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
      executedOrdersCount: this.executedOrders.length,
    });

    // 9. Dacă nu trebuie să plasez ordine, nu fac nimic
    if (buyOrdersNeeded === 0 && sellOrdersNeeded === 0) {
      this.loggingService.info('✅ Strategy satisfied, no new orders needed');
      return;
    }

    // 10. Plasez ordine conform strategiei
    const levels = this.config.levels;
    const levelDistance = this.config.levelDistance / 100;
    const orderSize = this.config.orderSize;

    // 11. BUY levels - conform strategiei
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

    // 12. SELL levels - conform strategiei
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

      case MarketMakingStrategy.ACCUMULATE: {
        // 80% BUY, 20% SELL
        const buyTarget = Math.floor(maxOrders * 0.8);
        const sellTarget = Math.floor(maxOrders * 0.2);
        return {
          buyOrdersNeeded: Math.max(0, buyTarget - currentBuyOrders),
          sellOrdersNeeded: Math.max(0, sellTarget - currentSellOrders),
        };
      }

      case MarketMakingStrategy.DISTRIBUTE: {
        // 20% BUY, 80% SELL
        const buyTargetDist = Math.floor(maxOrders * 0.2);
        const sellTargetDist = Math.floor(maxOrders * 0.8);
        return {
          buyOrdersNeeded: Math.max(0, buyTargetDist - currentBuyOrders),
          sellOrdersNeeded: Math.max(0, sellTargetDist - currentSellOrders),
        };
      }

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
          quantity: formatMexcQuantity(amount),
          price: formatMexcPrice(price),
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
        `Failed to place BUY order on ${exchange}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
        'MarketMakingService',
      );

      // Log detailed error information
      const errorDetails = {
        exchange,
        price,
        amount,
        errorType: typeof error,
        errorConstructor: error?.constructor?.name,
        errorKeys: error ? Object.keys(error) : [],
        fullError: JSON.stringify(error, null, 2),
      };

      this.loggingService.info('Place BUY order error details', errorDetails);
      this.writeDebugLog('PLACE_BUY_ORDER_ERROR', errorDetails);
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
          quantity: formatMexcQuantity(amount),
          price: formatMexcPrice(price),
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
        `Failed to place SELL order on ${exchange}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
        'MarketMakingService',
      );

      // Log detailed error information
      const errorDetails = {
        exchange,
        price,
        amount,
        errorType: typeof error,
        errorConstructor: error?.constructor?.name,
        errorKeys: error ? Object.keys(error) : [],
        fullError: JSON.stringify(error, null, 2),
      };

      this.loggingService.info('Place SELL order error details', errorDetails);
      this.writeDebugLog('PLACE_SELL_ORDER_ERROR', errorDetails);
    }
  }

  /**
   * Cancel a specific order
   */
  private async cancelOrder(order: ActiveOrder): Promise<void> {
    try {
      this.loggingService.info(`Attempting to cancel order`, {
        id: order.id,
        orderId: order.orderId,
        type: typeof order.orderId,
        price: order.price,
        side: order.side,
      });

      if (order.exchange === 'MEXC') {
        try {
          // Use MexcApiService.cancelOrder with the full order ID (including prefix)
          await this.mexcApiService.cancelOrder('ILMTUSDT', order.orderId);
        } catch (cancelError: any) {
          // If order doesn't exist (404/-2011), just log and continue with removal
          if (
            cancelError.statusCode === 404 ||
            (cancelError.context && cancelError.context.code === -2011)
          ) {
            this.loggingService.info(
              `Order ${order.orderId} was already removed from MEXC during cancel`,
            );
            this.writeDebugLog('CANCEL_ORDER_ALREADY_REMOVED', {
              orderId: order.orderId,
              orderSide: order.side,
              orderPrice: order.price,
              reason: 'Order already removed from MEXC during cancel',
            });
            // Continue with local removal
          } else {
            // Re-throw other errors
            throw cancelError;
          }
        }
      }
      // Remove from active orders
      this.activeOrders = this.activeOrders.filter(
        (o) => o.orderId !== order.orderId,
      );
      this.loggingService.info(`❌ Order cancelled`, {
        orderId: order.orderId,
        exchange: order.exchange,
        side: order.side,
        price: order.price,
      });
    } catch (error) {
      this.loggingService.error(
        `Failed to cancel order ${order.orderId}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
        'MarketMakingService',
      );

      // Enhanced error logging with more context
      const errorDetails = {
        orderId: order.orderId,
        orderSide: order.side,
        orderPrice: order.price,
        errorType: typeof error,
        errorConstructor: error?.constructor?.name,
        errorKeys: error ? Object.keys(error) : [],
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        errorString: String(error),
        errorJSON: JSON.stringify(error, Object.getOwnPropertyNames(error), 2),
      };

      this.loggingService.info(
        '🔍 ENHANCED Cancel order error details',
        errorDetails,
      );
      this.writeDebugLog('CANCEL_ORDER_ERROR', errorDetails);

      // Try to extract more specific error information
      if (error && typeof error === 'object') {
        const errorObj = error as any;
        this.loggingService.info('🔍 Raw cancel error object properties', {
          hasResponse: !!errorObj.response,
          hasData: !!errorObj.data,
          hasStatus: !!errorObj.status,
          hasCode: !!errorObj.code,
          responseStatus: errorObj.response?.status,
          responseData: errorObj.response?.data,
          responseStatusText: errorObj.response?.statusText,
          axiosErrorCode: errorObj.code,
          axiosErrorMessage: errorObj.message,
        });
      }
    }
  }

  /**
   * Cancel all active orders
   */
  private async cancelAllOrders(): Promise<void> {
    this.loggingService.info(
      `Cancelling all ${this.activeOrders.length} active orders`,
    );

    const cancelPromises = this.activeOrders.map((order) =>
      this.cancelOrder(order),
    );
    await Promise.allSettled(cancelPromises);

    this.activeOrders = [];
  }

  /**
   * Detect executed orders by comparing current active orders with MEXC open orders
   */
  private async detectExecutedOrders(mexcOpenOrders: any[]): Promise<void> {
    const mexcOrderIds = mexcOpenOrders.map((o) => o.orderId.toString());
    const executedInThisCycle: ExecutedOrder[] = [];

    // Find orders that were in our active list but are no longer on MEXC
    for (const localOrder of this.activeOrders) {
      if (!mexcOrderIds.includes(localOrder.orderId)) {
        // This order was executed/filled
        const executedOrder: ExecutedOrder = {
          orderId: localOrder.orderId,
          exchange: localOrder.exchange,
          side: localOrder.side,
          price: localOrder.price,
          amount: localOrder.amount,
          executedAt: new Date(),
          replacementPlaced: false,
        };

        executedInThisCycle.push(executedOrder);
        this.executedOrders.push(executedOrder);

        this.loggingService.info(`🎯 Order EXECUTED detected`, {
          orderId: localOrder.orderId,
          side: localOrder.side,
          price: localOrder.price,
          amount: localOrder.amount,
          executedAt: executedOrder.executedAt,
        });

        this.writeDebugLog('ORDER_EXECUTED', {
          orderId: localOrder.orderId,
          side: localOrder.side,
          price: localOrder.price,
          amount: localOrder.amount,
          executedAt: executedOrder.executedAt,
        });
      }
    }

    // Log execution summary
    if (executedInThisCycle.length > 0) {
      const buyExecuted = executedInThisCycle.filter((o) => o.side === 'BUY');
      const sellExecuted = executedInThisCycle.filter((o) => o.side === 'SELL');

      this.loggingService.info(
        `📊 Orders executed in this cycle: ${executedInThisCycle.length}`,
        {
          buyExecuted: buyExecuted.length,
          sellExecuted: sellExecuted.length,
          totalExecuted: executedInThisCycle.length,
          executedOrdersList: executedInThisCycle.map((o) => ({
            orderId: o.orderId,
            side: o.side,
            price: o.price,
            amount: o.amount,
          })),
        },
      );

      // Clean up old executed orders (keep only last 100)
      if (this.executedOrders.length > 100) {
        this.executedOrders = this.executedOrders.slice(-100);
      }
    }
  }

  /**
   * Place strategic replacement orders for executed orders
   */
  private async placeStrategicReplacements(
    currentPrice: number,
  ): Promise<void> {
    const unprocessedExecuted = this.executedOrders.filter(
      (o) =>
        !o.replacementPlaced && o.executedAt.getTime() > Date.now() - 300000, // Last 5 minutes
    );

    if (unprocessedExecuted.length === 0) {
      return;
    }

    this.loggingService.info(
      `🎯 Placing strategic replacements for ${unprocessedExecuted.length} executed orders`,
    );

    for (const executedOrder of unprocessedExecuted) {
      try {
        // Calculate strategic replacement price based on execution
        const newPrice = this.calculateStrategicReplacementPrice(
          executedOrder,
          currentPrice,
        );

        // Check if we have balance to place the replacement
        const hasBalance = await this.checkBalanceForOrder(
          executedOrder.side,
          newPrice,
          executedOrder.amount,
        );

        if (!hasBalance) {
          this.loggingService.warn(
            `Insufficient balance for strategic replacement of ${executedOrder.side} order: ${executedOrder.orderId} ${executedOrder.side} @${newPrice} (${executedOrder.amount} ILMT)`,
          );
          continue;
        }

        // Place the strategic replacement order
        if (executedOrder.side === 'BUY') {
          await this.placeBuyOrder('MEXC', newPrice, executedOrder.amount);
        } else {
          await this.placeSellOrder('MEXC', newPrice, executedOrder.amount);
        }

        // Mark as processed
        executedOrder.replacementPlaced = true;

        this.loggingService.info(
          `✅ Strategic replacement placed for executed ${executedOrder.side} order`,
          {
            originalOrderId: executedOrder.orderId,
            originalPrice: executedOrder.price,
            newPrice,
            side: executedOrder.side,
            amount: executedOrder.amount,
          },
        );

        this.writeDebugLog('STRATEGIC_REPLACEMENT_PLACED', {
          originalOrderId: executedOrder.orderId,
          originalPrice: executedOrder.price,
          newPrice,
          side: executedOrder.side,
          amount: executedOrder.amount,
        });
      } catch (error) {
        this.loggingService.error(
          `Failed to place strategic replacement for order ${executedOrder.orderId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * Calculate strategic replacement price for an executed order
   */
  private calculateStrategicReplacementPrice(
    executedOrder: ExecutedOrder,
    currentPrice: number,
  ): number {
    const levelDistance = this.config.levelDistance / 100;
    const spread = this.config.spread / 100;

    if (executedOrder.side === 'BUY') {
      // For executed BUY orders, place new BUY order slightly below current price
      // This maintains our accumulation strategy
      return parseFloat((currentPrice * (1 - levelDistance)).toFixed(6));
    } else {
      // For executed SELL orders, place new SELL order slightly above current price
      // This maintains our distribution strategy
      return parseFloat((currentPrice * (1 + levelDistance)).toFixed(6));
    }
  }

  /**
   * Check if we have sufficient balance for an order
   */
  private async checkBalanceForOrder(
    side: 'BUY' | 'SELL',
    price: number,
    amount: number,
  ): Promise<boolean> {
    try {
      const account = await this.mexcApiService.getAccount();

      if (side === 'BUY') {
        const usdt = account.balances.find((b) => b.asset === 'USDT');
        const requiredUsdt = price * amount;
        return usdt ? parseFloat(usdt.free) >= requiredUsdt : false;
      } else {
        const ilmt = account.balances.find((b) => b.asset === 'ILMT');
        return ilmt ? parseFloat(ilmt.free) >= amount : false;
      }
    } catch (error) {
      this.loggingService.error(`Failed to check balance for order: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      config: this.config,
      activeOrders: this.activeOrders.length,
      orders: this.activeOrders,
      strategy: this.config.strategy,
      executedOrders: this.executedOrders.length,
      recentExecutions: this.executedOrders.slice(-10), // Last 10 executions
    };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<MarketMakingConfig>): void {
    Object.assign(this.config, newConfig);
    this.loggingService.info('Market making config updated', { newConfig });
  }

  /**
   * Rebalansează ordinele prea departe de preț în loc să le anuleze
   */
  private async rebalanceOrders(currentPrice: number): Promise<void> {
    const maxDistance = (this.config.maxRebalanceDistance || 5.0) / 100;
    const levelDistance = this.config.levelDistance / 100;

    const ordersToRebalance = this.activeOrders.filter((order) => {
      const deviation = Math.abs(order.price - currentPrice) / currentPrice;
      // Verifică dacă orderul este într-adevăr prea departe
      const isTooFar = deviation > maxDistance;

      // Verifică dacă orderul a fost rebalansiat recent (ultimele 2 minute)
      const recentlyRebalanced =
        Date.now() - order.timestamp.getTime() < 120000; // 2 minute

      return isTooFar && !recentlyRebalanced;
    });

    if (ordersToRebalance.length === 0) {
      return;
    }

    this.loggingService.info(
      `🔄 Rebalancing ${ordersToRebalance.length} orders too far from price`,
      {
        currentPrice,
        maxDistance: maxDistance * 100,
        ordersToRebalance: ordersToRebalance.map((o) => ({
          orderId: o.orderId,
          side: o.side,
          oldPrice: o.price,
          deviation:
            ((Math.abs(o.price - currentPrice) / currentPrice) * 100).toFixed(
              2,
            ) + '%',
        })),
      },
    );

    for (const order of ordersToRebalance) {
      try {
        // 1. Verifică din nou dacă orderul există pe MEXC înainte de anulare
        const currentOrders =
          await this.mexcApiService.getOpenOrders('ILMTUSDT');
        const orderStillExists = currentOrders.some(
          (o) => o.orderId.toString() === order.orderId,
        );

        if (!orderStillExists) {
          this.loggingService.info(
            `Order ${order.orderId} no longer exists on MEXC during rebalance, removing from local list`,
          );
          this.writeDebugLog('REBALANCE_ORDER_NOT_FOUND', {
            orderId: order.orderId,
            orderSide: order.side,
            orderPrice: order.price,
            reason: 'Order not found on MEXC during rebalance check',
          });

          // Remove from local list since it doesn't exist on MEXC
          this.activeOrders = this.activeOrders.filter(
            (o) => o.orderId !== order.orderId,
          );
          continue;
        }

        // 2. Anulează orderul vechi (doar dacă există)
        try {
          await this.mexcApiService.cancelOrder('ILMTUSDT', order.orderId);
        } catch (cancelError: any) {
          // If order doesn't exist (404/-2011), remove from local list and continue
          if (
            cancelError.statusCode === 404 ||
            (cancelError.context && cancelError.context.code === -2011)
          ) {
            this.loggingService.info(
              `Order ${order.orderId} was already removed from MEXC, cleaning up local list`,
            );
            this.activeOrders = this.activeOrders.filter(
              (o) => o.orderId !== order.orderId,
            );
            this.writeDebugLog('REBALANCE_ORDER_ALREADY_REMOVED', {
              orderId: order.orderId,
              orderSide: order.side,
              orderPrice: order.price,
              reason: 'Order already removed from MEXC',
            });
            continue;
          }
          // Re-throw other errors
          throw cancelError;
        }

        // 3. Calculează noul preț mai aproape de piață
        let newPrice: number;
        if (order.side === 'BUY') {
          // Pentru BUY, plasează la primul nivel sub preț
          newPrice = parseFloat(
            (currentPrice * (1 - levelDistance)).toFixed(6),
          );
        } else {
          // Pentru SELL, plasează la primul nivel peste preț
          newPrice = parseFloat(
            (currentPrice * (1 + levelDistance)).toFixed(6),
          );
        }

        // 4. Plasează noul order la prețul calculat
        const newOrder = await this.mexcApiService.placeOrder({
          symbol: 'ILMTUSDT',
          side: order.side,
          type: 'LIMIT',
          quantity: formatMexcQuantity(order.amount),
          price: formatMexcPrice(newPrice),
          timeInForce: 'GTC',
        });

        // 5. Actualizează lista locală de ordine
        // Înlocuiește orderul vechi cu cel nou
        const orderIndex = this.activeOrders.findIndex(
          (o) => o.orderId === order.orderId,
        );
        if (orderIndex !== -1) {
          this.activeOrders[orderIndex] = {
            id: newOrder.orderId.toString(),
            orderId: newOrder.orderId.toString(),
            exchange: 'MEXC',
            side: order.side,
            price: newPrice,
            amount: order.amount,
            timestamp: new Date(),
          };
        }

        this.loggingService.info(`✅ Order rebalanced: ${order.side}`, {
          oldOrderId: order.orderId,
          newOrderId: newOrder.orderId,
          oldPrice: order.price,
          newPrice,
          side: order.side,
          amount: order.amount,
        });

        this.writeDebugLog('REBALANCE_ORDER_SUCCESS', {
          oldOrderId: order.orderId,
          newOrderId: newOrder.orderId.toString(),
          oldPrice: order.price,
          newPrice,
          side: order.side,
          amount: order.amount,
        });
      } catch (error) {
        this.loggingService.error(
          `Failed to rebalance order ${order.orderId}: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
          'MarketMakingService',
        );

        // Enhanced error logging with more context
        const errorDetails = {
          orderId: order.orderId,
          orderSide: order.side,
          orderPrice: order.price,
          currentPrice,
          newPrice:
            order.side === 'BUY'
              ? parseFloat((currentPrice * (1 - levelDistance)).toFixed(6))
              : parseFloat((currentPrice * (1 + levelDistance)).toFixed(6)),
          errorType: typeof error,
          errorConstructor: error?.constructor?.name,
          errorKeys: error ? Object.keys(error) : [],
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
          errorString: String(error),
          errorJSON: JSON.stringify(
            error,
            Object.getOwnPropertyNames(error),
            2,
          ),
        };

        this.loggingService.info(
          '🔍 ENHANCED Rebalance error details',
          errorDetails,
        );
        this.writeDebugLog('REBALANCE_ORDER_ERROR', errorDetails);

        // Try to extract more specific error information
        if (error && typeof error === 'object') {
          const errorObj = error as any;
          this.loggingService.info('🔍 Raw error object properties', {
            hasResponse: !!errorObj.response,
            hasData: !!errorObj.data,
            hasStatus: !!errorObj.status,
            hasCode: !!errorObj.code,
            responseStatus: errorObj.response?.status,
            responseData: errorObj.response?.data,
            responseStatusText: errorObj.response?.statusText,
            axiosErrorCode: errorObj.code,
            axiosErrorMessage: errorObj.message,
          });
        }
      }
    }
  }
}
