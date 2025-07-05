import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LoggingService } from '../../logging/logging.service';
import { MexcApiService } from '../../mexc/services/mexc-api.service';
import { PancakeSwapService } from '../../pancakeswap/services/pancakeswap.service';
import {
  ExchangePrice,
  ArbitrageOpportunity,
  ArbitrageConfig,
  PriceStaleError,
  ARBITRAGE_CONSTANTS,
  EXCHANGE_FEES,
  ArbitrageDirection,
} from '../types/arbitrage.types';

@Injectable()
export class PriceCalculatorService {
  private mexcPrice: ExchangePrice | null = null;
  private pancakeswapPrice: ExchangePrice | null = null;
  private currentOpportunity: ArbitrageOpportunity | null = null;
  private config!: ArbitrageConfig;
  private mexcInterval: NodeJS.Timeout | null = null;
  private pancakeswapInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly loggingService: LoggingService,
    private readonly mexcApiService: MexcApiService,
    private readonly pancakeSwapService: PancakeSwapService,
  ) {
    this.initializeConfig();
  }

  private initializeConfig(): void {
    this.config = {
      enabled: this.configService.get<boolean>('BOT_ENABLED') || false,
      symbol: 'ILMTUSDT',
      minSpread: this.configService.get<number>('MIN_PROFIT_THRESHOLD') || 1.0,
      maxSpread: 50.0, // 50% max spread for safety
      priceUpdateInterval: 5000, // 5 seconds
      opportunityTimeout: ARBITRAGE_CONSTANTS.DEFAULT_OPPORTUNITY_TIMEOUT,
      executionTimeout: ARBITRAGE_CONSTANTS.DEFAULT_EXECUTION_TIMEOUT,
      riskManagement: {
        maxTradeSize: this.configService.get<number>('MAX_TRADE_SIZE') || 500,
        maxDailyVolume:
          this.configService.get<number>('MAX_DAILY_VOLUME') || 5000,
        maxTradesPerHour:
          this.configService.get<number>('MAX_TRADES_PER_HOUR') || 20,
        minProfitThreshold:
          this.configService.get<number>('MIN_PROFIT_THRESHOLD') || 1.0,
        maxSlippage: this.configService.get<number>('MAX_SLIPPAGE') || 0.5,
        emergencyStopLoss:
          this.configService.get<number>('EMERGENCY_STOP_LOSS_RATIO') || 0.05,
        balanceThresholds: {
          usdt:
            this.configService.get<number>('MIN_BALANCE_THRESHOLD_USDT') || 10,
          ilmt:
            this.configService.get<number>('MIN_BALANCE_THRESHOLD_ILMT') || 1,
          bnb:
            this.configService.get<number>('MIN_BALANCE_THRESHOLD_BNB') || 0.01,
        },
        cooldownPeriod: this.configService.get<number>('COOLDOWN_MS') || 5000,
      },
      exchanges: {
        mexc: {
          enabled: true,
          fees: {
            maker: EXCHANGE_FEES.MEXC.MAKER,
            taker: EXCHANGE_FEES.MEXC.TAKER,
          },
        },
        pancakeswap: {
          enabled: true,
          fees: {
            swap: EXCHANGE_FEES.PANCAKESWAP.SWAP,
            gas: EXCHANGE_FEES.PANCAKESWAP.GAS_ESTIMATE,
          },
          slippage: this.configService.get<number>('MAX_SLIPPAGE') || 0.5,
        },
      },
    };
  }

  async updateMexcPrice(): Promise<void> {
    try {
      const ticker = await this.mexcApiService.getTicker(this.config.symbol);
      const bookTicker = await this.mexcApiService.getBookTicker(
        this.config.symbol,
      );

      this.mexcPrice = {
        exchange: 'MEXC',
        symbol: this.config.symbol,
        bidPrice: parseFloat(bookTicker.bidPrice),
        askPrice: parseFloat(bookTicker.askPrice),
        volume: parseFloat(ticker.volume || '0'),
        timestamp: new Date(),
        source: 'REST',
      };

      this.eventEmitter.emit('price.updated', {
        exchange: 'MEXC',
        price: this.mexcPrice,
      });

      this.loggingService.info(
        `💰 MEXC: BID=${this.mexcPrice.bidPrice} ASK=${this.mexcPrice.askPrice} SPREAD=${(((this.mexcPrice.askPrice - this.mexcPrice.bidPrice) / this.mexcPrice.bidPrice) * 100).toFixed(3)}% VOL=${(this.mexcPrice.volume / 1000000).toFixed(1)}M`,
        {
          component: 'PriceCalculatorService',
          symbol: this.config.symbol,
          bid: this.mexcPrice.bidPrice,
          ask: this.mexcPrice.askPrice,
          volume: this.mexcPrice.volume,
        },
      );

      this.checkArbitrageOpportunity();
    } catch (error) {
      this.loggingService.error(
        '❌ Failed to update MEXC price',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async updatePancakeSwapPrice(): Promise<void> {
    try {
      const ilmtToken = {
        symbol: 'ILMT',
        address:
          this.configService.get<string>('ILMT_TOKEN_ADDRESS') ||
          '0x0000000000000000000000000000000000000000',
        decimals: 18,
        name: 'ILMT Token',
      };

      const usdtToken = {
        symbol: 'USDT',
        address:
          this.configService.get<string>('USDT_TOKEN_ADDRESS') ||
          '0x0000000000000000000000000000000000000000',
        decimals: 18,
        name: 'USDT Token',
      };

      // Use direct price calculation from reserves
      const priceData = await this.pancakeSwapService.calculatePriceFromReserves(
        ilmtToken,
        usdtToken,
      );

      // Calculate bid/ask with slippage
      const midPrice = parseFloat(priceData.price);
      const slippageAmount =
        midPrice * (this.config.exchanges.pancakeswap.slippage / 100);

      this.pancakeswapPrice = {
        exchange: 'PANCAKESWAP',
        symbol: this.config.symbol,
        bidPrice: midPrice - slippageAmount, // Price when selling ILMT for USDT
        askPrice: midPrice + slippageAmount, // Price when buying ILMT with USDT
        volume: 0, // PancakeSwap doesn't provide 24h volume easily
        timestamp: new Date(),
        source: 'CONTRACT',
      };

      this.eventEmitter.emit('price.updated', {
        exchange: 'PANCAKESWAP',
        price: this.pancakeswapPrice,
      });

      this.loggingService.info(
        `🥞 PANCAKESWAP: BID=${this.pancakeswapPrice.bidPrice.toFixed(6)} ASK=${this.pancakeswapPrice.askPrice.toFixed(6)} SPREAD=${(((this.pancakeswapPrice.askPrice - this.pancakeswapPrice.bidPrice) / this.pancakeswapPrice.bidPrice) * 100).toFixed(3)}% LIQ=${priceData.liquidityUsd ? `$${priceData.liquidityUsd}` : 'N/A'}`,
        {
          component: 'PriceCalculatorService',
          symbol: this.config.symbol,
          bid: this.pancakeswapPrice.bidPrice,
          ask: this.pancakeswapPrice.askPrice,
          midPrice: midPrice,
          liquidityUsd: priceData.liquidityUsd,
        },
      );

      this.checkArbitrageOpportunity();
    } catch (error) {
      this.loggingService.error(
        '❌ Failed to update PancakeSwap price',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private checkArbitrageOpportunity(): void {
    if (!this.mexcPrice || !this.pancakeswapPrice) {
      return; // Need both prices to calculate arbitrage
    }

    if (!this.isPriceDataFresh()) {
      return; // Don't calculate on stale data
    }

    // Calculate detailed price comparisons
    const mexcSpreadPercent =
      ((this.mexcPrice.askPrice - this.mexcPrice.bidPrice) /
        this.mexcPrice.bidPrice) *
      100;
    const pancakeSpreadPercent =
      ((this.pancakeswapPrice.askPrice - this.pancakeswapPrice.bidPrice) /
        this.pancakeswapPrice.bidPrice) *
      100;

    // Calculate arbitrage opportunities
    const mexcToPancakeSpread =
      ((this.pancakeswapPrice.bidPrice - this.mexcPrice.askPrice) /
        this.mexcPrice.askPrice) *
      100;
    const pancakeToMexcSpread =
      ((this.mexcPrice.bidPrice - this.pancakeswapPrice.askPrice) /
        this.pancakeswapPrice.askPrice) *
      100;
    
    // Calculate optimal trade sizes based on liquidity
    const maxTradeSizeMexcToPancake = this.calculateOptimalTradeSize(
      this.mexcPrice.askPrice,
      this.pancakeswapPrice.bidPrice,
      'MEXC_TO_PANCAKE'
    );
    
    const maxTradeSizePancakeToMexc = this.calculateOptimalTradeSize(
      this.pancakeswapPrice.askPrice,
      this.mexcPrice.bidPrice,
      'PANCAKE_TO_MEXC'
    );

    // Log comprehensive price comparison
    this.loggingService.info(
      `🔍 PRICE ANALYSIS | MEXC: ${this.mexcPrice.bidPrice}/${this.mexcPrice.askPrice} (${mexcSpreadPercent.toFixed(3)}%) | PANCAKE: ${this.pancakeswapPrice.bidPrice.toFixed(6)}/${this.pancakeswapPrice.askPrice.toFixed(6)} (${pancakeSpreadPercent.toFixed(3)}%)`,
      {
        component: 'PriceCalculatorService',
        timestamp: new Date().toISOString(),
        mexc: {
          bid: this.mexcPrice.bidPrice,
          ask: this.mexcPrice.askPrice,
          spread: mexcSpreadPercent,
          volume24h: this.mexcPrice.volume,
        },
        pancakeswap: {
          bid: this.pancakeswapPrice.bidPrice,
          ask: this.pancakeswapPrice.askPrice,
          spread: pancakeSpreadPercent,
        },
        arbitrage: {
          mexcToPancake: {
            spread: mexcToPancakeSpread,
            profitable: mexcToPancakeSpread > this.config.minSpread,
            maxTradeSize: maxTradeSizeMexcToPancake,
            buyAt: this.mexcPrice.askPrice,
            sellAt: this.pancakeswapPrice.bidPrice,
          },
          pancakeToMexc: {
            spread: pancakeToMexcSpread,
            profitable: pancakeToMexcSpread > this.config.minSpread,
            maxTradeSize: maxTradeSizePancakeToMexc,
            buyAt: this.pancakeswapPrice.askPrice,
            sellAt: this.mexcPrice.bidPrice,
          },
        },
        minSpreadRequired: this.config.minSpread,
      },
    );

    const opportunities = this.calculateArbitrageOpportunities();

    for (const opportunity of opportunities) {
      if (this.isOpportunityValid(opportunity)) {
        this.currentOpportunity = opportunity;

        this.eventEmitter.emit('opportunity.detected', opportunity);

        this.loggingService.info(
          `🚨 ARBITRAGE OPPORTUNITY! ${opportunity.buyExchange}→${opportunity.sellExchange} | Spread: ${opportunity.spreadPercentage.toFixed(3)}% | Profit: ${opportunity.netProfitPercentage.toFixed(3)}% | Size: $${opportunity.maxTradeSize}`,
          {
            component: 'PriceCalculatorService',
            opportunityId: opportunity.id,
            direction: `${opportunity.buyExchange} → ${opportunity.sellExchange}`,
            buyPrice: opportunity.buyPrice,
            sellPrice: opportunity.sellPrice,
            spreadPercentage: opportunity.spreadPercentage,
            netProfitPercentage: opportunity.netProfitPercentage,
            estimatedProfit: opportunity.estimatedProfit,
            maxTradeSize: opportunity.maxTradeSize,
            confidence: opportunity.confidence,
            riskLevel: opportunity.riskLevel,
          },
        );

        // Set expiration timer
        setTimeout(() => {
          if (this.currentOpportunity?.id === opportunity.id) {
            this.expireOpportunity(opportunity.id, 'TIMEOUT');
          }
        }, this.config.opportunityTimeout);

        break; // Take the best opportunity
      }
    }

    // If no opportunities found, log why
    if (opportunities.length === 0) {
      this.loggingService.info(
        `⚪ No arbitrage opportunities | Best spreads: MEXC→PANCAKE: ${mexcToPancakeSpread.toFixed(3)}% | PANCAKE→MEXC: ${pancakeToMexcSpread.toFixed(3)}% | Min required: ${this.config.minSpread}%`,
        {
          component: 'PriceCalculatorService',
          reason: 'All spreads below minimum threshold',
          bestSpreads: {
            mexcToPancake: mexcToPancakeSpread,
            pancakeToMexc: pancakeToMexcSpread,
          },
          minSpreadRequired: this.config.minSpread,
        },
      );
    }
  }

  private calculateOptimalTradeSize(
    buyPrice: number,
    sellPrice: number,
    direction: 'MEXC_TO_PANCAKE' | 'PANCAKE_TO_MEXC'
  ): number {
    // Conservative approach based on spread and liquidity
    const baseTradeSize = 10; // $100 base trade size
    const maxTradeSize = 100; // $1000 max trade size
    
    // Calculate spread percentage
    const spreadPercent = ((sellPrice - buyPrice) / buyPrice) * 100;
    
    // Adjust trade size based on spread - higher spread allows for larger trades
    let optimalSize = baseTradeSize;
    
    if (spreadPercent > 2) {
      optimalSize = Math.min(maxTradeSize, baseTradeSize * 5);
    } else if (spreadPercent > 1) {
      optimalSize = Math.min(maxTradeSize, baseTradeSize * 3);
    } else if (spreadPercent > 0.5) {
      optimalSize = Math.min(maxTradeSize, baseTradeSize * 2);
    }
    
    // For DEX trades, consider slippage impact
    if (direction === 'MEXC_TO_PANCAKE' || direction === 'PANCAKE_TO_MEXC') {
      // Reduce size for DEX trades due to slippage
      optimalSize = optimalSize * 0.7;
    }
    
    return Math.round(optimalSize);
  }

  private calculateArbitrageOpportunities(): ArbitrageOpportunity[] {
    if (!this.mexcPrice || !this.pancakeswapPrice) {
      return [];
    }

    const opportunities: ArbitrageOpportunity[] = [];
    const timestamp = new Date();

    // Direction 1: Buy on MEXC, Sell on PancakeSwap
    const mexcToPancake = this.calculateOpportunity(
      'MEXC_TO_PANCAKE',
      this.mexcPrice.askPrice, // Buy on MEXC at ask price
      this.pancakeswapPrice.bidPrice, // Sell on PancakeSwap at bid price
      timestamp,
    );

    if (mexcToPancake) {
      opportunities.push(mexcToPancake);
    }

    // Direction 2: Buy on PancakeSwap, Sell on MEXC
    const pancakeToMexc = this.calculateOpportunity(
      'PANCAKE_TO_MEXC',
      this.pancakeswapPrice.askPrice, // Buy on PancakeSwap at ask price
      this.mexcPrice.bidPrice, // Sell on MEXC at bid price
      timestamp,
    );

    if (pancakeToMexc) {
      opportunities.push(pancakeToMexc);
    }

    // Sort by net profit percentage (descending)
    return opportunities.sort(
      (a, b) => b.netProfitPercentage - a.netProfitPercentage,
    );
  }

  private calculateOpportunity(
    direction: ArbitrageDirection,
    buyPrice: number,
    sellPrice: number,
    timestamp: Date,
  ): ArbitrageOpportunity | null {
    const spread = sellPrice - buyPrice;
    const spreadPercentage = (spread / buyPrice) * 100;

    if (spreadPercentage < this.config.minSpread) {
      return null; // Not profitable enough
    }

    const buyExchange =
      direction === 'MEXC_TO_PANCAKE' ? 'MEXC' : 'PANCAKESWAP';
    const sellExchange =
      direction === 'MEXC_TO_PANCAKE' ? 'PANCAKESWAP' : 'MEXC';

    // Calculate fees
    const mexcFee = this.config.exchanges.mexc.fees.taker;
    const pancakeswapFee = this.config.exchanges.pancakeswap.fees.swap;
    const gasFee =
      direction === 'MEXC_TO_PANCAKE'
        ? this.config.exchanges.pancakeswap.fees.gas
        : this.config.exchanges.pancakeswap.fees.gas;

    const totalFees = mexcFee + pancakeswapFee + gasFee;

    // Estimate profit for a $100 trade
    const tradeAmount = 100;
    const grossProfit = tradeAmount * (spreadPercentage / 100);
    const totalFeeCost = tradeAmount * totalFees;
    const netProfit = grossProfit - totalFeeCost;
    const netProfitPercentage = (netProfit / tradeAmount) * 100;

    // Calculate maximum trade size based on liquidity and balance
    const maxTradeSize = Math.min(
      this.config.riskManagement.maxTradeSize,
      this.estimateMaxTradeSize(buyExchange),
    );

    // Determine confidence and risk level
    const confidence = this.calculateConfidence(
      spreadPercentage,
      netProfitPercentage,
    );
    const riskLevel = this.calculateRiskLevel(spreadPercentage, maxTradeSize);

    return {
      id: `${direction}_${timestamp.getTime()}`,
      symbol: this.config.symbol,
      buyExchange,
      sellExchange,
      buyPrice,
      sellPrice,
      spread,
      spreadPercentage,
      estimatedProfit: grossProfit,
      estimatedProfitPercentage: spreadPercentage,
      maxTradeSize,
      timestamp,
      expiresAt: new Date(timestamp.getTime() + this.config.opportunityTimeout),
      mexcFee,
      pancakeswapFee,
      gasCost: tradeAmount * gasFee,
      totalFees: totalFeeCost,
      netProfit,
      netProfitPercentage,
      confidence,
      riskLevel,
    };
  }

  private estimateMaxTradeSize(buyExchange: string): number {
    // This is a simplified estimation
    // In a real implementation, this would check:
    // - Order book depth on MEXC
    // - Liquidity pool reserves on PancakeSwap
    // - Current wallet balances
    // - Gas costs vs trade size efficiency

    if (buyExchange === 'MEXC') {
      // Estimate based on MEXC order book depth (simplified)
      return Math.min(1000, this.mexcPrice?.volume || 0 * 0.01);
    } else {
      // Estimate based on PancakeSwap liquidity (simplified)
      return 500; // Conservative estimate
    }
  }

  private calculateConfidence(
    spreadPercentage: number,
    netProfitPercentage: number,
  ): 'HIGH' | 'MEDIUM' | 'LOW' {
    if (netProfitPercentage > 2.0 && spreadPercentage > 3.0) {
      return 'HIGH';
    } else if (netProfitPercentage > 1.0 && spreadPercentage > 2.0) {
      return 'MEDIUM';
    } else {
      return 'LOW';
    }
  }

  private calculateRiskLevel(
    spreadPercentage: number,
    maxTradeSize: number,
  ): 'LOW' | 'MEDIUM' | 'HIGH' {
    if (spreadPercentage > 5.0 || maxTradeSize > 1000) {
      return 'HIGH';
    } else if (spreadPercentage > 2.0 || maxTradeSize > 500) {
      return 'MEDIUM';
    } else {
      return 'LOW';
    }
  }

  private isOpportunityValid(opportunity: ArbitrageOpportunity): boolean {
    return (
      opportunity.netProfitPercentage >=
        this.config.riskManagement.minProfitThreshold &&
      opportunity.spreadPercentage <= this.config.maxSpread &&
      opportunity.maxTradeSize >= 5 && // Minimum $5 trade pentru teste
      opportunity.confidence !== 'LOW' &&
      opportunity.riskLevel !== 'HIGH'
    );
  }

  private isPriceDataFresh(): boolean {
    const now = Date.now();
    const mexcAge = this.mexcPrice
      ? now - this.mexcPrice.timestamp.getTime()
      : Infinity;
    const pancakeAge = this.pancakeswapPrice
      ? now - this.pancakeswapPrice.timestamp.getTime()
      : Infinity;

    if (mexcAge > ARBITRAGE_CONSTANTS.PRICE_STALENESS_THRESHOLD) {
      throw new PriceStaleError(
        'MEXC',
        mexcAge,
        ARBITRAGE_CONSTANTS.PRICE_STALENESS_THRESHOLD,
      );
    }

    if (pancakeAge > ARBITRAGE_CONSTANTS.PRICE_STALENESS_THRESHOLD) {
      throw new PriceStaleError(
        'PANCAKESWAP',
        pancakeAge,
        ARBITRAGE_CONSTANTS.PRICE_STALENESS_THRESHOLD,
      );
    }

    return true;
  }

  private expireOpportunity(id: string, reason: string): void {
    if (this.currentOpportunity?.id === id) {
      this.eventEmitter.emit('opportunity.expired', { id, reason });

      this.loggingService.info('Arbitrage opportunity expired', {
        component: 'PriceCalculatorService',
        opportunityId: id,
        reason,
      });

      this.currentOpportunity = null;
    }
  }

  // Public methods
  getCurrentOpportunity(): ArbitrageOpportunity | null {
    return this.currentOpportunity;
  }

  getCurrentPrices(): {
    mexc: ExchangePrice | null;
    pancakeswap: ExchangePrice | null;
  } {
    return {
      mexc: this.mexcPrice,
      pancakeswap: this.pancakeswapPrice,
    };
  }

  getConfig(): ArbitrageConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<ArbitrageConfig>): void {
    this.config = { ...this.config, ...updates };

    this.loggingService.info('Arbitrage config updated', {
      component: 'PriceCalculatorService',
      updates,
    });
  }

  async startPriceUpdates(): Promise<void> {
    this.loggingService.info('Starting price updates', {
      component: 'PriceCalculatorService',
      interval: this.config.priceUpdateInterval,
    });

    // Initial price fetch
    await Promise.all([this.updateMexcPrice(), this.updatePancakeSwapPrice()]);

    // Set up periodic updates and store intervals
    this.mexcInterval = setInterval(() => {
      this.updateMexcPrice().catch(() => {}); // Silent fail
    }, this.config.priceUpdateInterval);

    this.pancakeswapInterval = setInterval(() => {
      this.updatePancakeSwapPrice().catch(() => {}); // Silent fail
    }, this.config.priceUpdateInterval);
  }

  stopPriceUpdates(): void {
    this.loggingService.info('Stopping price updates', {
      component: 'PriceCalculatorService',
    });

    // Clear intervals
    if (this.mexcInterval) {
      clearInterval(this.mexcInterval);
      this.mexcInterval = null;
    }

    if (this.pancakeswapInterval) {
      clearInterval(this.pancakeswapInterval);
      this.pancakeswapInterval = null;
    }

    // Reset state
    this.mexcPrice = null;
    this.pancakeswapPrice = null;
    this.currentOpportunity = null;
  }
}
