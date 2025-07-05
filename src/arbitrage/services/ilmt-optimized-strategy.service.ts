import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LoggingService } from '../../logging/logging.service';
import { MexcApiService } from '../../mexc/services/mexc-api.service';
import { PancakeSwapService } from '../../pancakeswap/services/pancakeswap.service';
import { ExchangePrice } from '../types/arbitrage.types';

export interface ILMTStrategy {
  type: 'SELL_HIGH_PRICE' | 'SELL_BALANCED' | 'ACCUMULATE_USDT' | 'WAIT';
  exchange?: 'MEXC' | 'PANCAKESWAP' | 'BOTH';
  amount: number;
  expectedUsdtGain: number;
  reasoning: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface ILMTPortfolio {
  mexc: {
    ilmt: number;
    usdt: number;
  };
  pancakeswap: {
    ilmt: number;
    usdt: number;
  };
  total: {
    ilmt: number;
    usdt: number;
    valueAtCurrentPrice: number;
  };
}

@Injectable()
export class ILMTOptimizedStrategyService {
  private currentPortfolio: ILMTPortfolio | null = null;
  private priceHistory: Array<{
    mexc: number;
    pancakeswap: number;
    timestamp: Date;
  }> = [];
  private lastStrategyExecution: Date | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly loggingService: LoggingService,
    private readonly mexcApiService: MexcApiService,
    private readonly pancakeSwapService: PancakeSwapService,
  ) {}

  /**
   * Analizează prețurile actuale și recomandă strategia optimă
   */
  async analyzeOptimalStrategy(
    mexcPrice: ExchangePrice,
    pancakeswapPrice: ExchangePrice,
  ): Promise<ILMTStrategy> {
    // Actualizează portfolio-ul
    await this.updatePortfolio();

    // Actualizează istoricul prețurilor
    this.updatePriceHistory(mexcPrice, pancakeswapPrice);

    // Calculează diferența de preț
    const mexcMidPrice = (mexcPrice.bidPrice + mexcPrice.askPrice) / 2;
    const pancakeMidPrice =
      (pancakeswapPrice.bidPrice + pancakeswapPrice.askPrice) / 2;

    const priceDifference = Math.abs(mexcMidPrice - pancakeMidPrice);
    const priceDifferencePercent =
      (priceDifference / Math.min(mexcMidPrice, pancakeMidPrice)) * 100;

    // Identifică exchange-ul cu prețul mai mare
    const higherPriceExchange =
      mexcMidPrice > pancakeMidPrice ? 'MEXC' : 'PANCAKESWAP';
    const higherPrice = Math.max(mexcMidPrice, pancakeMidPrice);
    const lowerPrice = Math.min(mexcMidPrice, pancakeMidPrice);

    // Calculează tendința prețului
    const priceTrend = this.calculatePriceTrend();

    this.loggingService.info(
      `🧠 ILMT STRATEGY ANALYSIS | MEXC: $${mexcMidPrice.toFixed(6)} | PANCAKE: $${pancakeMidPrice.toFixed(6)} | Diff: ${priceDifferencePercent.toFixed(3)}% | Higher: ${higherPriceExchange}`,
      {
        component: 'ILMTOptimizedStrategyService',
        mexcPrice: mexcMidPrice,
        pancakeswapPrice: pancakeMidPrice,
        priceDifference: priceDifferencePercent,
        higherPriceExchange,
        priceTrend: priceTrend,
        portfolio: this.currentPortfolio,
      },
    );

    // Strategii în ordine de prioritate
    if (priceDifferencePercent > 2.0) {
      return this.createSellHighPriceStrategy(
        higherPriceExchange,
        higherPrice,
        lowerPrice,
      );
    } else if (priceDifferencePercent > 0.8) {
      return this.createBalancedSellStrategy(mexcMidPrice, pancakeMidPrice);
    } else if (priceTrend === 'RISING' && this.shouldAccumulateUsdt()) {
      return this.createAccumulateUsdtStrategy(mexcMidPrice, pancakeMidPrice);
    } else {
      return this.createWaitStrategy(priceDifferencePercent);
    }
  }

  /**
   * Strategia 1: Vinde pe exchange-ul cu prețul mai mare
   */
  private createSellHighPriceStrategy(
    exchange: 'MEXC' | 'PANCAKESWAP',
    higherPrice: number,
    lowerPrice: number,
  ): ILMTStrategy {
    const priceDiff = ((higherPrice - lowerPrice) / lowerPrice) * 100;
    const portfolio = this.currentPortfolio!;
    // Calculează cât ILMT să vinzi
    const availableIlmt =
      exchange === 'MEXC' ? portfolio.mexc.ilmt : portfolio.pancakeswap.ilmt;
    const maxSellAmount = Math.min(availableIlmt * 0.1, 50); // Max 10% din holdings sau 50 ILMT

    const expectedUsdtGain = maxSellAmount * higherPrice;

    return {
      type: 'SELL_HIGH_PRICE',
      exchange,
      amount: maxSellAmount,
      expectedUsdtGain,
      reasoning: `Sell ${maxSellAmount.toFixed(2)} ILMT on ${exchange} at $${higherPrice.toFixed(6)} (${priceDiff.toFixed(2)}% higher than other exchange)`,
      confidence: priceDiff > 3 ? 'HIGH' : priceDiff > 1.5 ? 'MEDIUM' : 'LOW',
    };
  }

  /**
   * Strategia 2: Vinde proporțional pe ambele exchange-uri
   */
  private createBalancedSellStrategy(
    mexcPrice: number,
    pancakePrice: number,
  ): ILMTStrategy {
    const portfolio = this.currentPortfolio!;
    const totalIlmt = portfolio.total.ilmt;

    // Vinde 5% din total, dar nu mai mult decât 50 ILMT
    const totalSellAmount = Math.min(totalIlmt * 0.05, 50);
    const mexcWeight = mexcPrice / (mexcPrice + pancakePrice);
    const mexcSellAmount = totalSellAmount * mexcWeight;
    const pancakeSellAmount = totalSellAmount * (1 - mexcWeight);

    const expectedUsdtGain =
      mexcSellAmount * mexcPrice + pancakeSellAmount * pancakePrice;

    return {
      type: 'SELL_BALANCED',
      exchange: 'BOTH',
      amount: totalSellAmount,
      expectedUsdtGain,
      reasoning: `Balanced sell: ${mexcSellAmount.toFixed(2)} ILMT on MEXC, ${pancakeSellAmount.toFixed(2)} ILMT on PancakeSwap`,
      confidence: 'MEDIUM',
    };
  }

  /**
   * Strategia 3: Acumulează USDT când prețul e în trend ascendent
   */
  private createAccumulateUsdtStrategy(
    mexcPrice: number,
    pancakePrice: number,
  ): ILMTStrategy {
    const portfolio = this.currentPortfolio!;

    // Vinde o cantitate mică pentru a acumula USDT
    const sellAmount = Math.min(portfolio.total.ilmt * 0.03, 50); // 3% sau max 50 ILMT
    const betterExchange = mexcPrice > pancakePrice ? 'MEXC' : 'PANCAKESWAP';
    const betterPrice = Math.max(mexcPrice, pancakePrice);

    const expectedUsdtGain = sellAmount * betterPrice;

    return {
      type: 'ACCUMULATE_USDT',
      exchange: betterExchange,
      amount: sellAmount,
      expectedUsdtGain,
      reasoning: `Accumulate USDT by selling ${sellAmount.toFixed(2)} ILMT on ${betterExchange} at rising price $${betterPrice.toFixed(6)}`,
      confidence: 'MEDIUM',
    };
  }

  /**
   * Strategia 4: Așteaptă oportunități mai bune
   */
  private createWaitStrategy(priceDifference: number): ILMTStrategy {
    return {
      type: 'WAIT',
      amount: 0,
      expectedUsdtGain: 0,
      reasoning: `Price difference too small (${priceDifference.toFixed(3)}%). Waiting for better opportunity.`,
      confidence: 'HIGH',
    };
  }

  /**
   * Actualizează portfolio-ul din balanțele exchange-urilor
   */
  private async updatePortfolio(): Promise<void> {
    try {
      // Obține balanțele MEXC
      const mexcAccount = await this.mexcApiService.getAccount();
      const mexcUsdtBalance = mexcAccount.balances.find(
        (b) => b.asset === 'USDT',
      );
      const mexcIlmtBalance = mexcAccount.balances.find(
        (b) => b.asset === 'ILMT',
      );

      // Obține balanțele PancakeSwap
      const pancakeUsdtBalance = await this.pancakeSwapService.getTokenBalance({
        symbol: 'USDT',
        address: this.configService.get<string>('USDT_TOKEN_ADDRESS') || '',
        decimals: 18,
      });
      const pancakeIlmtBalance = await this.pancakeSwapService.getTokenBalance({
        symbol: 'ILMT',
        address: this.configService.get<string>('ILMT_TOKEN_ADDRESS') || '',
        decimals: 18,
      });

      this.currentPortfolio = {
        mexc: {
          ilmt: parseFloat(mexcIlmtBalance?.free || '0'),
          usdt: parseFloat(mexcUsdtBalance?.free || '0'),
        },
        pancakeswap: {
          ilmt: parseFloat(pancakeIlmtBalance),
          usdt: parseFloat(pancakeUsdtBalance),
        },
        total: {
          ilmt: 0, // Calculat mai jos
          usdt: 0, // Calculat mai jos
          valueAtCurrentPrice: 0, // Calculat mai jos
        },
      };

      // Calculează totalurile
      this.currentPortfolio.total.ilmt =
        this.currentPortfolio.mexc.ilmt +
        this.currentPortfolio.pancakeswap.ilmt;
      this.currentPortfolio.total.usdt =
        this.currentPortfolio.mexc.usdt +
        this.currentPortfolio.pancakeswap.usdt;
    } catch (error) {
      this.loggingService.error(
        'Failed to update ILMT portfolio',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Actualizează istoricul prețurilor
   */
  private updatePriceHistory(
    mexcPrice: ExchangePrice,
    pancakeswapPrice: ExchangePrice,
  ): void {
    const mexcMid = (mexcPrice.bidPrice + mexcPrice.askPrice) / 2;
    const pancakeMid =
      (pancakeswapPrice.bidPrice + pancakeswapPrice.askPrice) / 2;

    this.priceHistory.push({
      mexc: mexcMid,
      pancakeswap: pancakeMid,
      timestamp: new Date(),
    });

    // Păstrează doar ultimele 50 de înregistrări
    if (this.priceHistory.length > 50) {
      this.priceHistory = this.priceHistory.slice(-50);
    }
  }

  /**
   * Calculează tendința prețului
   */
  private calculatePriceTrend(): 'RISING' | 'FALLING' | 'STABLE' {
    if (this.priceHistory.length < 5) return 'STABLE';

    const recent = this.priceHistory.slice(-5);
    const avgRecentMexc =
      recent.reduce((sum, p) => sum + p.mexc, 0) / recent.length;
    const avgRecentPancake =
      recent.reduce((sum, p) => sum + p.pancakeswap, 0) / recent.length;
    const avgRecent = (avgRecentMexc + avgRecentPancake) / 2;

    const older = this.priceHistory.slice(-10, -5);
    if (older.length === 0) return 'STABLE';

    const avgOlderMexc =
      older.reduce((sum, p) => sum + p.mexc, 0) / older.length;
    const avgOlderPancake =
      older.reduce((sum, p) => sum + p.pancakeswap, 0) / older.length;
    const avgOlder = (avgOlderMexc + avgOlderPancake) / 2;

    const change = ((avgRecent - avgOlder) / avgOlder) * 100;

    if (change > 1) return 'RISING';
    if (change < -1) return 'FALLING';
    return 'STABLE';
  }

  /**
   * Verifică dacă ar trebui să acumuleze USDT
   */
  private shouldAccumulateUsdt(): boolean {
    if (!this.currentPortfolio) return false;

    const totalValue = this.currentPortfolio.total.valueAtCurrentPrice;
    const usdtPercentage =
      (this.currentPortfolio.total.usdt / totalValue) * 100;

    // Acumulează USDT dacă reprezintă mai puțin de 20% din portofoliu
    return usdtPercentage < 20;
  }

  /**
   * Execută strategia recomandată
   */
  async executeStrategy(strategy: ILMTStrategy): Promise<boolean> {
    if (strategy.type === 'WAIT') {
      this.loggingService.info(`⏳ STRATEGY: ${strategy.reasoning}`);
      return false;
    }

    this.loggingService.info(
      `🚀 EXECUTING ILMT STRATEGY: ${strategy.type} | ${strategy.reasoning}`,
      {
        component: 'ILMTOptimizedStrategyService',
        strategy,
        portfolio: this.currentPortfolio,
      },
    );

    try {
      // Pentru MONITORING_MODE, doar logăm
      if (this.configService.get<boolean>('MONITORING_MODE', true)) {
        this.loggingService.info(
          `📊 [SIMULATION] Strategy executed: ${strategy.type} | Gain: $${strategy.expectedUsdtGain.toFixed(4)}`,
          {
            component: 'ILMTOptimizedStrategyService',
            simulation: true,
            strategy,
          },
        );
        return true;
      }

      // EXECUȚIA REALĂ - ATENȚIE: TRANZACȚII CU BANI ADEVĂRAȚI!
      const success = await this.executeRealTrade(strategy);

      if (success) {
        this.lastStrategyExecution = new Date();
        await this.updatePortfolio(); // Actualizează balanțele după tranzacție

        this.loggingService.info(
          `✅ [REAL TRADE] Strategy executed successfully: ${strategy.type} | Gain: $${strategy.expectedUsdtGain.toFixed(4)}`,
          {
            component: 'ILMTOptimizedStrategyService',
            realTrade: true,
            strategy,
            timestamp: new Date().toISOString(),
          },
        );
      }

      return success;
    } catch (error) {
      this.loggingService.error(
        `❌ FAILED TO EXECUTE STRATEGY: ${strategy.type} - ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }

  /**
   * Execută tranzacția reală pe exchange
   */
  private async executeRealTrade(strategy: ILMTStrategy): Promise<boolean> {
    // MĂSURI DE SIGURANȚĂ
    await this.validateTradeSafety(strategy);

    const MAX_RETRIES = 3;
    let retryCount = 0;

    while (retryCount < MAX_RETRIES) {
      try {
        this.loggingService.info(
          `🔄 Executing real trade (attempt ${retryCount + 1}/${MAX_RETRIES})`,
          {
            component: 'ILMTOptimizedStrategyService',
            strategy: strategy.type,
            amount: strategy.amount,
            exchange: strategy.exchange,
          },
        );

        switch (strategy.exchange) {
          case 'MEXC':
            return await this.executeMexcTrade(strategy);
          case 'PANCAKESWAP':
            return await this.executePancakeSwapTrade(strategy);
          case 'BOTH':
            return await this.executeBalancedTrade(strategy);
          default:
            throw new Error(`Unknown exchange: ${strategy.exchange}`);
        }
      } catch (error) {
        retryCount++;
        this.loggingService.error(
          `💥 Trade execution failed (attempt ${retryCount}/${MAX_RETRIES})`,
          error instanceof Error ? error.message : String(error),
        );

        if (retryCount >= MAX_RETRIES) {
          throw error;
        }

        // Așteaptă 2 secunde înainte de retry
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    return false;
  }

  /**
   * Execută tranzacția pe MEXC
   */
  private async executeMexcTrade(strategy: ILMTStrategy): Promise<boolean> {
    if (
      !this.currentPortfolio ||
      this.currentPortfolio.mexc.ilmt < strategy.amount
    ) {
      throw new Error(
        `Insufficient ILMT balance on MEXC: ${this.currentPortfolio?.mexc.ilmt || 0} < ${strategy.amount}`,
      );
    }

    // Plasează order de vânzare pe MEXC
    const order = await this.mexcApiService.placeSellOrder(
      'ILMTUSDT',
      strategy.amount,
    );

    // Verifică dacă order-ul a fost executat
    await this.waitForOrderExecution(order.orderId.toString(), 'MEXC');

    return true;
  }

  /**
   * Execută tranzacția pe PancakeSwap (SIMPLIFIED VERSION)
   */
  private async executePancakeSwapTrade(
    strategy: ILMTStrategy,
  ): Promise<boolean> {
    if (
      !this.currentPortfolio ||
      this.currentPortfolio.pancakeswap.ilmt < strategy.amount
    ) {
      throw new Error(
        `Insufficient ILMT balance on PancakeSwap: ${this.currentPortfolio?.pancakeswap.ilmt || 0} < ${strategy.amount}`,
      );
    }

    // Folosește metoda simplificată bazată pe implementarea React
    const result = await this.pancakeSwapService.sellILMTForUSDTSimplified(
      strategy.amount,
    );

    this.loggingService.info('✅ PancakeSwap trade executed (simplified)', {
      component: 'ILMTOptimizedStrategyService',
      result,
      strategy: strategy.type,
      amount: strategy.amount,
    });

    return result.success;
  }

  /**
   * Execută tranzacția pe ambele exchange-uri (balanced)
   */
  private async executeBalancedTrade(strategy: ILMTStrategy): Promise<boolean> {
    if (!this.currentPortfolio) {
      throw new Error('Portfolio not available');
    }

    const totalIlmt = this.currentPortfolio.total.ilmt;
    const mexcRatio = this.currentPortfolio.mexc.ilmt / totalIlmt;
    const pancakeRatio = this.currentPortfolio.pancakeswap.ilmt / totalIlmt;

    const mexcAmount = strategy.amount * mexcRatio;
    const pancakeAmount = strategy.amount * pancakeRatio;

    // Execută pe ambele exchange-uri în paralel
    const [mexcResult, pancakeResult] = await Promise.allSettled([
      this.executeMexcTrade({
        ...strategy,
        amount: mexcAmount,
        exchange: 'MEXC',
      }),
      this.executePancakeSwapTrade({
        ...strategy,
        amount: pancakeAmount,
        exchange: 'PANCAKESWAP',
      }),
    ]);

    const mexcSuccess = mexcResult.status === 'fulfilled' && mexcResult.value;
    const pancakeSuccess =
      pancakeResult.status === 'fulfilled' && pancakeResult.value;

    if (!mexcSuccess) {
      this.loggingService.error(
        'MEXC trade failed',
        mexcResult.status === 'rejected' ? mexcResult.reason : 'Unknown error',
      );
    }

    if (!pancakeSuccess) {
      this.loggingService.error(
        'PancakeSwap trade failed',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        pancakeResult.status === 'rejected'
          ? pancakeResult.reason
          : 'Unknown error',
      );
    }

    // Consideră succesul dacă cel puțin una dintre tranzacții a reușit
    return mexcSuccess || pancakeSuccess;
  }

  /**
   * Așteaptă executarea unui order pe MEXC
   */
  private async waitForOrderExecution(
    orderId: string,
    exchange: string,
    timeoutMs: number = 30000,
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        const orderStatus = await this.mexcApiService.getOrderStatus(
          'ILMTUSDT',
          orderId,
        );

        if (orderStatus.status === 'FILLED') {
          this.loggingService.info(
            `✅ Order ${orderId} executed successfully on ${exchange}`,
          );
          return;
        }

        if (
          orderStatus.status === 'CANCELED' ||
          orderStatus.status === 'REJECTED'
        ) {
          throw new Error(
            `Order ${orderId} was ${orderStatus.status.toLowerCase()}`,
          );
        }

        // Așteaptă 1 secundă înainte de următoarea verificare
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        this.loggingService.error(
          `Failed to check order status: ${orderId}`,
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    }

    throw new Error(`Order ${orderId} execution timeout after ${timeoutMs}ms`);
  }

  /**
   * Obține portfolio-ul curent
   */
  getCurrentPortfolio(): ILMTPortfolio | null {
    return this.currentPortfolio;
  }

  /**
   * Obține istoricul prețurilor
   */
  getPriceHistory(): Array<{
    mexc: number;
    pancakeswap: number;
    timestamp: Date;
  }> {
    return [...this.priceHistory];
  }

  /**
   * Validează siguranța tranzacției înainte de execuție
   */
  private async validateTradeSafety(strategy: ILMTStrategy): Promise<void> {
    const MAX_TRADE_AMOUNT = this.configService.get<number>(
      'MAX_TRADE_SIZE',
      50,
    ); // Default 50 ILMT
    const MIN_TRADE_AMOUNT = this.configService.get<number>(
      'MIN_TRADE_SIZE',
      1,
    ); // Default 1 ILMT
    const MAX_DAILY_TRADES = this.configService.get<number>(
      'MAX_DAILY_TRADES',
      100,
    ); // Default 100 trades/day

    // Verifică limita de sumă
    if (strategy.amount > MAX_TRADE_AMOUNT) {
      throw new Error(
        `❌ SAFETY STOP: Trade amount ${strategy.amount} exceeds maximum allowed ${MAX_TRADE_AMOUNT} ILMT`,
      );
    }

    if (strategy.amount < MIN_TRADE_AMOUNT) {
      throw new Error(
        `❌ SAFETY STOP: Trade amount ${strategy.amount} below minimum ${MIN_TRADE_AMOUNT} ILMT`,
      );
    }

    // Verifică balance disponibil
    if (!this.currentPortfolio) {
      throw new Error('❌ SAFETY STOP: Portfolio not available');
    }

    const totalIlmt = this.currentPortfolio.total.ilmt;
    const tradePercentage = (strategy.amount / totalIlmt) * 100;

    if (tradePercentage > 20) {
      throw new Error(
        `❌ SAFETY STOP: Trade represents ${tradePercentage.toFixed(1)}% of total ILMT (max 20%)`,
      );
    }

    // Verifică dacă nu suntem în test mode
    const isTestMode = false; // Default to real trading mode
    if (!isTestMode) {
      this.loggingService.warn(
        `⚠️ REAL MONEY TRADE: ${strategy.amount} ILMT = ~$${strategy.expectedUsdtGain.toFixed(4)} on ${strategy.exchange}`,
      );

      // Așteaptă 3 secunde pentru a permite anularea
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    this.loggingService.info(
      `✅ SAFETY CHECK PASSED: ${strategy.type} - ${strategy.amount} ILMT on ${strategy.exchange}`,
    );
  }
}
