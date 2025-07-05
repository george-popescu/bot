/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Interval, Cron, CronExpression } from '@nestjs/schedule';
import { LoggingService } from '../../logging/logging.service';
import { PriceCalculatorService } from './price-calculator.service';
import { ArbitrageExecutorService } from './arbitrage-executor.service';
import { MexcApiService } from '../../mexc/services/mexc-api.service';
import { PancakeSwapService } from '../../pancakeswap/services/pancakeswap.service';
import { MexcWebSocketService } from '../../mexc/services/mexc-websocket.service';
import {
  ArbitrageOpportunity,
  ArbitrageTrade,
  ArbitrageMetrics,
  BalanceSnapshot,
  ArbitrageConfig,
  PriceAlert,
  ARBITRAGE_CONSTANTS,
} from '../types/arbitrage.types';
import { EnvironmentVariables } from '../../config/validation.schema';
import { MonitoringService } from './monitoring.service';
import { ILMTOptimizedStrategyService } from './ilmt-optimized-strategy.service';

@Injectable()
export class ArbitrageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ArbitrageService.name);

  private isActive = false;
  private isPaused = false;
  private lastTradeTime: Date | null = null;
  private dailyStats = {
    trades: 0,
    volume: 0,
    profit: 0,
    fees: 0,
    opportunities: 0,
    rejectedTrades: 0,
  };
  private hourlyTradeCount = 0;
  private lastHourReset = new Date();
  private completedTrades: ArbitrageTrade[] = [];
  private alerts: PriceAlert[] = [];
  private lastBalanceCheck: Date | null = null;
  private config: ArbitrageConfig;
  private isMonitoringMode: boolean;
  private activeTrades = new Map<string, ArbitrageTrade>();
  private virtualBalance = {
    usdt: 100, // Virtual starting balance redus pentru teste
    ilmt: 100,
    bnb: 0.1,
  };
  private isBotEnabled: boolean;
  private minProfitThreshold: number;
  private isProcessing = false;

  // 🔒 GLOBAL EXECUTION LOCKING SYSTEM
  private static isGloballyExecuting = false;
  private static executionQueue: (() => Promise<void>)[] = [];
  private static currentExecutionId: string | null = null;
  private static lastExecutionTime: Date | null = null;
  private static readonly MIN_EXECUTION_INTERVAL = 3000; // 3 secunde între execuții

  constructor(
    private readonly configService: ConfigService<EnvironmentVariables>,
    private readonly eventEmitter: EventEmitter2,
    private readonly loggingService: LoggingService,
    private readonly priceCalculator: PriceCalculatorService,
    private readonly executor: ArbitrageExecutorService,
    private readonly mexcApiService: MexcApiService,
    private readonly pancakeSwapService: PancakeSwapService,
    private readonly mexcWebSocketService: MexcWebSocketService,
    private readonly monitoringService: MonitoringService,
    private readonly ilmtOptimizedStrategyService: ILMTOptimizedStrategyService,
  ) {
    this.config = this.priceCalculator.getConfig();
    this.isMonitoringMode = this.configService.get<boolean>(
      'MONITORING_MODE',
      true,
    );
    this.isBotEnabled = this.configService.get<boolean>('BOT_ENABLED', false);
    this.minProfitThreshold = this.configService.get<number>('MIN_PROFIT_THRESHOLD', 1.0);

    if (this.isMonitoringMode) {
      this.logger.warn(
        '🔍 MONITORING MODE ENABLED - No real trades will be executed',
      );
    }

    this.loggingService.info(
      `🚀 ARBITRAGE SERVICE INITIALIZED | Mode: ${this.isMonitoringMode ? 'MONITORING' : 'LIVE'} | Bot: ${this.isBotEnabled ? 'ENABLED' : 'DISABLED'} | Min Profit: ${this.minProfitThreshold}%`,
      {
        component: 'ArbitrageService',
        isMonitoringMode: this.isMonitoringMode,
        isBotEnabled: this.isBotEnabled,
        minProfitThreshold: this.minProfitThreshold,
      },
    );
  }

  async onModuleInit() {
    if (this.configService.get<boolean>('BOT_ENABLED')) {
      await this.start();
    }
  }

  onModuleDestroy() {
    this.stop();
  }

  async start(): Promise<void> {
    if (this.isActive) {
      this.loggingService.info('Arbitrage service is already active', {
        component: 'ArbitrageService',
      });
      return;
    }

    this.loggingService.info('Starting arbitrage service', {
      component: 'ArbitrageService',
      config: this.priceCalculator.getConfig(),
    });

    this.isActive = true;
    this.isPaused = false;

    // Start price updates
    await this.priceCalculator.startPriceUpdates();

    // Reset daily stats
    this.resetDailyStats();

    this.eventEmitter.emit('system.status', { status: 'ACTIVE' });

    this.loggingService.info('Arbitrage service started successfully', {
      component: 'ArbitrageService',
    });
  }

  stop(): void {
    if (!this.isActive) {
      return;
    }

    this.loggingService.info('Stopping arbitrage service', {
      component: 'ArbitrageService',
    });

    this.isActive = false;
    this.isPaused = false;

    // Stop price updates
    this.priceCalculator.stopPriceUpdates();

    this.eventEmitter.emit('system.status', { status: 'STOPPED' });

    this.loggingService.info('Arbitrage service stopped', {
      component: 'ArbitrageService',
    });
  }

  pause(reason?: string): void {
    if (!this.isActive || this.isPaused) {
      return;
    }

    this.isPaused = true;
    this.eventEmitter.emit('system.status', { status: 'PAUSED', reason });

    this.loggingService.info('Arbitrage service paused', {
      component: 'ArbitrageService',
      reason,
    });
  }

  resume(): void {
    if (!this.isActive || !this.isPaused) {
      return;
    }

    this.isPaused = false;
    this.eventEmitter.emit('system.status', { status: 'ACTIVE' });

    this.loggingService.info('Arbitrage service resumed', {
      component: 'ArbitrageService',
    });
  }

  @OnEvent('opportunity.detected')
  async handleOpportunityDetected(
    opportunity: ArbitrageOpportunity,
  ): Promise<void> {
    if (!this.isActive || this.isPaused) {
      return;
    }

    // 🔒 CHECK GLOBAL LOCK - SKIP dacă altă execuție este în curs
    if (ArbitrageService.isGloballyExecuting) {
      this.loggingService.info('🔒 Skipping event-driven opportunity - another execution in progress', {
        component: 'ArbitrageService',
        opportunityId: opportunity.id,
        currentExecution: ArbitrageService.currentExecutionId,
      });
      return;
    }

    this.loggingService.info('Opportunity detected, evaluating for execution', {
      component: 'ArbitrageService',
      opportunityId: opportunity.id,
      netProfitPercentage: opportunity.netProfitPercentage,
      confidence: opportunity.confidence,
    });

    try {
      // Check risk management constraints
      if (!this.checkRiskLimits(opportunity)) {
        return;
      }

      // Check cooldown period
      if (this.lastTradeTime && this.isInCooldownPeriod()) {
        this.loggingService.info(
          'Skipping opportunity due to cooldown period',
          {
            component: 'ArbitrageService',
            opportunityId: opportunity.id,
            cooldownRemaining: this.getCooldownRemaining(),
          },
        );
        return;
      }

      // Calculate optimal trade size
      const tradeSize = this.calculateOptimalTradeSize(opportunity);

      if (tradeSize < 5) {
        // Minimum $5 trade pentru teste
        this.loggingService.info('Trade size too small, skipping opportunity', {
          component: 'ArbitrageService',
          opportunityId: opportunity.id,
          calculatedSize: tradeSize,
        });
        return;
      }

      // 🎯 QUEUE EXECUTION instead of immediate execution
      await this.queueExecution(async () => {
        await this.executeArbitrage(opportunity);
        this.lastTradeTime = new Date();
        this.hourlyTradeCount++;
        this.dailyStats.opportunities++;
      }, `event-${opportunity.id}`);

    } catch (error) {
      this.loggingService.error(
        'Error handling opportunity detection',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  @OnEvent('trade.completed')
  handleTradeCompleted(trade: ArbitrageTrade): void {
    this.completedTrades.push(trade);

    // Keep only last 1000 trades in memory
    if (this.completedTrades.length > 1000) {
      this.completedTrades = this.completedTrades.slice(-1000);
    }

    this.loggingService.info('Trade completed', {
      component: 'ArbitrageService',
      tradeId: trade.id,
      netProfit: trade.netProfit,
      executionTime: trade.executionTime,
    });
  }

  @OnEvent('trade.failed')
  handleTradeFailed(event: { trade: ArbitrageTrade; error: string }): void {
    this.completedTrades.push(event.trade);

    this.loggingService.info('Trade failed', {
      component: 'ArbitrageService',
      tradeId: event.trade.id,
      error: event.error,
    });

    // If multiple trades fail in a row, pause the system
    const recentFailures = this.getRecentTradeFailures();
    if (recentFailures >= 3) {
      this.pause(
        `Multiple trade failures: ${recentFailures} failures in last 10 minutes`,
      );
    }
  }

  private checkRiskLimits(opportunity: ArbitrageOpportunity): boolean {
    const config = this.priceCalculator.getConfig();

    // Check hourly trade limit
    if (this.hourlyTradeCount >= config.riskManagement.maxTradesPerHour) {
      this.eventEmitter.emit('risk.exceeded', {
        type: 'HOURLY_TRADES',
        value: this.hourlyTradeCount,
        limit: config.riskManagement.maxTradesPerHour,
      });
      return false;
    }

    // Check daily volume limit
    if (this.dailyStats.volume >= config.riskManagement.maxDailyVolume) {
      this.eventEmitter.emit('risk.exceeded', {
        type: 'DAILY_VOLUME',
        value: this.dailyStats.volume,
        limit: config.riskManagement.maxDailyVolume,
      });
      return false;
    }

    // Check profit threshold
    if (
      opportunity.netProfitPercentage < config.riskManagement.minProfitThreshold
    ) {
      return false;
    }

    return true;
  }

  private calculateOptimalTradeSize(opportunity: ArbitrageOpportunity): number {
    const config = this.priceCalculator.getConfig();

    // Start with maximum allowed trade size
    let tradeSize = Math.min(
      opportunity.maxTradeSize,
      config.riskManagement.maxTradeSize,
    );

    // Reduce based on remaining daily volume
    const remainingDailyVolume =
      config.riskManagement.maxDailyVolume - this.dailyStats.volume;
    tradeSize = Math.min(tradeSize, remainingDailyVolume);

    // Adjust based on confidence level
    switch (opportunity.confidence) {
      case 'HIGH':
        tradeSize *= 1.0; // Full size
        break;
      case 'MEDIUM':
        tradeSize *= 0.7; // 70% of calculated size
        break;
      case 'LOW':
        tradeSize *= 0.5; // 50% of calculated size
        break;
    }

    // Adjust based on risk level
    switch (opportunity.riskLevel) {
      case 'LOW':
        tradeSize *= 1.0; // Full size
        break;
      case 'MEDIUM':
        tradeSize *= 0.8; // 80% of calculated size
        break;
      case 'HIGH':
        tradeSize *= 0.5; // 50% of calculated size
        break;
    }

    return Math.floor(tradeSize);
  }

  private isInCooldownPeriod(): boolean {
    if (!this.lastTradeTime) {
      return false;
    }

    const config = this.priceCalculator.getConfig();
    const cooldownMs = config.riskManagement.cooldownPeriod;
    const timeSinceLastTrade = Date.now() - this.lastTradeTime.getTime();

    return timeSinceLastTrade < cooldownMs;
  }

  private getCooldownRemaining(): number {
    if (!this.lastTradeTime) {
      return 0;
    }

    const config = this.priceCalculator.getConfig();
    const cooldownMs = config.riskManagement.cooldownPeriod;
    const timeSinceLastTrade = Date.now() - this.lastTradeTime.getTime();

    return Math.max(0, cooldownMs - timeSinceLastTrade);
  }

  private updateDailyStats(trade: ArbitrageTrade): void {
    this.dailyStats.trades++;
    this.dailyStats.volume += trade.amount;
    this.dailyStats.profit += trade.netProfit;
    this.dailyStats.fees += trade.totalFees;
  }

  private getRecentTradeFailures(): number {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    return this.completedTrades.filter(
      (trade) =>
        trade.status === 'FAILED' &&
        trade.completedAt &&
        trade.completedAt > tenMinutesAgo,
    ).length;
  }

  @Interval(60000) // Run every minute
  private handleHourlyReset(): void {
    const now = new Date();

    if (now.getHours() !== this.lastHourReset.getHours()) {
      this.hourlyTradeCount = 0;
      this.lastHourReset = now;
    }
  }

  @Interval(ARBITRAGE_CONSTANTS.BALANCE_CHECK_INTERVAL)
  private async checkBalances(): Promise<void> {
    if (!this.isActive) {
      return;
    }

    try {
      const balanceSnapshot = await this.getBalanceSnapshot();
      const config = this.priceCalculator.getConfig();

      // Check minimum balance thresholds
      if (
        balanceSnapshot.total.usdt <
        config.riskManagement.balanceThresholds.usdt
      ) {
        this.createAlert('BALANCE_LOW', 'USDT balance below threshold', {
          current: balanceSnapshot.total.usdt,
          threshold: config.riskManagement.balanceThresholds.usdt,
        });
      }

      if (
        balanceSnapshot.total.ilmt <
        config.riskManagement.balanceThresholds.ilmt
      ) {
        this.createAlert('BALANCE_LOW', 'ILMT balance below threshold', {
          current: balanceSnapshot.total.ilmt,
          threshold: config.riskManagement.balanceThresholds.ilmt,
        });
      }

      if (
        balanceSnapshot.total.bnb < config.riskManagement.balanceThresholds.bnb
      ) {
        this.createAlert('BALANCE_LOW', 'BNB balance below threshold', {
          current: balanceSnapshot.total.bnb,
          threshold: config.riskManagement.balanceThresholds.bnb,
        });
      }

      this.eventEmitter.emit('balance.updated', balanceSnapshot);
      this.lastBalanceCheck = new Date();
    } catch (error) {
      this.loggingService.info('Failed to check balances', {
        component: 'ArbitrageService',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async getBalanceSnapshot(): Promise<BalanceSnapshot> {
    const [mexcAccount, usdtBalance, ilmtBalance, bnbBalance] =
      await Promise.all([
        this.mexcApiService.getAccount(),
        this.pancakeSwapService.getTokenBalance({
          symbol: 'USDT',
          address: '0x55d398326f99059fF775485246999027B3197955',
          decimals: 18,
        }),
        this.pancakeSwapService.getTokenBalance({
          symbol: 'ILMT',
          address: '0x0000000000000000000000000000000000000000',
          decimals: 18,
        }),
        this.pancakeSwapService.getBNBBalance(),
      ]);

    const mexcUsdt = parseFloat(
      mexcAccount.balances.find((b) => b.asset === 'USDT')?.free || '0',
    );
    const mexcIlmt = parseFloat(
      mexcAccount.balances.find((b) => b.asset === 'ILMT')?.free || '0',
    );
    const pancakeUsdt = parseFloat(usdtBalance);
    const pancakeIlmt = parseFloat(ilmtBalance);
    const pancakeBnb = parseFloat(bnbBalance);

    return {
      timestamp: new Date(),
      mexc: {
        usdt: mexcUsdt,
        ilmt: mexcIlmt,
      },
      pancakeswap: {
        usdt: pancakeUsdt,
        ilmt: pancakeIlmt,
        bnb: pancakeBnb,
      },
      total: {
        usdt: mexcUsdt + pancakeUsdt,
        ilmt: mexcIlmt + pancakeIlmt,
        bnb: pancakeBnb,
      },
    };
  }

  private createAlert(type: string, message: string, context?: any): void {
    const alert: PriceAlert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      symbol: 'ILMTUSDT',
      type: type as any,
      threshold: 0,
      currentValue: 0,
      message,
      timestamp: new Date(),
      acknowledged: false,
    };

    this.alerts.push(alert);
    this.eventEmitter.emit('alert.triggered', alert);

    this.loggingService.info('Alert triggered', {
      component: 'ArbitrageService',
      alertId: alert.id,
      type,
      message,
      context,
    });
  }

  private resetDailyStats(): void {
    this.dailyStats = {
      trades: 0,
      volume: 0,
      profit: 0,
      fees: 0,
      opportunities: 0,
      rejectedTrades: 0,
    };
  }

  // Public API methods
  getStatus(): {
    isActive: boolean;
    isPaused: boolean;
    lastTradeTime: Date | null;
    cooldownRemaining: number;
  } {
    return {
      isActive: this.isActive,
      isPaused: this.isPaused,
      lastTradeTime: this.lastTradeTime,
      cooldownRemaining: this.getCooldownRemaining(),
    };
  }

  getMetrics(): ArbitrageMetrics {
    const successfulTrades = this.completedTrades.filter(
      (t) => t.status === 'COMPLETED',
    );
    const failedTrades = this.completedTrades.filter(
      (t) => t.status === 'FAILED',
    );

    return {
      totalTrades: this.completedTrades.length,
      successfulTrades: successfulTrades.length,
      failedTrades: failedTrades.length,
      totalVolume: this.completedTrades.reduce((sum, t) => sum + t.amount, 0),
      totalProfit: this.completedTrades.reduce(
        (sum, t) => sum + t.totalProfit,
        0,
      ),
      totalFees: this.completedTrades.reduce((sum, t) => sum + t.totalFees, 0),
      netProfit: this.completedTrades.reduce((sum, t) => sum + t.netProfit, 0),
      averageProfit:
        successfulTrades.length > 0
          ? successfulTrades.reduce((sum, t) => sum + t.netProfit, 0) /
            successfulTrades.length
          : 0,
      winRate:
        this.completedTrades.length > 0
          ? (successfulTrades.length / this.completedTrades.length) * 100
          : 0,
      averageExecutionTime:
        this.completedTrades.length > 0
          ? this.completedTrades.reduce((sum, t) => sum + t.executionTime, 0) /
            this.completedTrades.length
          : 0,
      largestProfit: Math.max(...successfulTrades.map((t) => t.netProfit), 0),
      largestLoss: Math.min(...failedTrades.map((t) => t.netProfit), 0),
      dailyStats: [
        {
          date: new Date().toISOString().split('T')[0],
          trades: this.dailyStats.trades,
          volume: this.dailyStats.volume,
          profit: this.dailyStats.profit,
        },
      ],
    };
  }

  getCurrentOpportunity(): ArbitrageOpportunity | null {
    return this.priceCalculator.getCurrentOpportunity();
  }

  getCurrentPrices() {
    return this.priceCalculator.getCurrentPrices();
  }

  getActiveTrades(): ArbitrageTrade[] {
    return [...this.activeTrades.values()];
  }

  getCompletedTrades(): ArbitrageTrade[] {
    return [...this.completedTrades];
  }

  getAlerts(): PriceAlert[] {
    return [...this.alerts];
  }

  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      return true;
    }
    return false;
  }

  updateConfig(updates: Partial<ArbitrageConfig>): void {
    this.priceCalculator.updateConfig(updates);
  }

  getConfig(): ArbitrageConfig {
    return this.priceCalculator.getConfig();
  }

  private async executeArbitrage(
    opportunity: ArbitrageOpportunity,
  ): Promise<void> {
    const tradeId = `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      if (this.isMonitoringMode) {
        await this.simulateArbitrage(opportunity, tradeId);
        return;
      }

      // Real execution (original code)
      const trade = await this.executor.executeArbitrage(
        opportunity,
        parseFloat(tradeId),
      );

      if (trade) {
        this.activeTrades.set(tradeId, trade);
        this.updateDailyStats(trade);
        this.logger.log(`✅ Real trade executed: ${tradeId}`);
      }
    } catch (error) {
      this.logger.error(`❌ Trade execution failed: ${tradeId}`, error);
    }
  }

  private async simulateArbitrage(
    opportunity: ArbitrageOpportunity,
    tradeId: string,
  ): Promise<void> {
    const tradeSize = Math.min(
      opportunity.maxTradeSize,
      this.config.riskManagement.maxTradeSize,
    );

    // Virtual balance check
    if (opportunity.buyExchange === 'MEXC') {
      if (this.virtualBalance.usdt < tradeSize) {
        this.logger.warn(
          `🚫 [SIMULATION] Trade ${tradeId} - Insufficient virtual USDT balance`,
          {
            component: 'ArbitrageService',
            required: tradeSize,
            available: this.virtualBalance.usdt,
          },
        );
        this.dailyStats.rejectedTrades++;
        return;
      }
    } else {
      if (this.virtualBalance.ilmt < tradeSize) {
        this.logger.warn(
          `🚫 [SIMULATION] Trade ${tradeId} - Insufficient virtual ILMT balance`,
          {
            component: 'ArbitrageService',
            required: tradeSize,
            available: this.virtualBalance.ilmt,
          },
        );
        this.dailyStats.rejectedTrades++;
        return;
      }
    }

    // Get REAL current prices from PriceCalculatorService
    const currentPrices = this.priceCalculator.getCurrentPrices();

    if (!currentPrices.mexc || !currentPrices.pancakeswap) {
      this.logger.error(
        `🚫 [SIMULATION] Trade ${tradeId} - Missing real price data`,
        {
          component: 'ArbitrageService',
          mexcPrice: currentPrices.mexc,
          pancakeswapPrice: currentPrices.pancakeswap,
        },
      );
      return;
    }

    // Calculate REAL execution with current prices
    const startTime = Date.now();
    let mexcExecutionPrice: number;
    let pancakeswapExecutionPrice: number;
    let realSpread: number;
    let realNetProfit: number;
    let mexcFee: number;
    let pancakeswapFee: number;
    let gasCost: number;

    try {
      // Simulate real API timing by actually calling price endpoints (read-only)
      const [mexcBook, pancakeQuote] = await Promise.all([
        this.mexcApiService.getBookTicker(this.config.symbol).catch(() => null),
        this.pancakeSwapService
          .getQuote(
            {
              symbol: 'USDT',
              address: this.configService.get('USDT_TOKEN_ADDRESS') || '',
              decimals: 18,
            },
            {
              symbol: 'ILMT',
              address: this.configService.get('ILMT_TOKEN_ADDRESS') || '',
              decimals: 18,
            },
            tradeSize.toString(),
            this.config.exchanges.pancakeswap.slippage / 100,
          )
          .catch(() => null),
      ]);

      // Use REAL prices from the price calculator (most recent)
      if (opportunity.buyExchange === 'MEXC') {
        // Buy on MEXC, sell on PancakeSwap
        mexcExecutionPrice = currentPrices.mexc.askPrice; // We're buying from MEXC
        pancakeswapExecutionPrice = currentPrices.pancakeswap.bidPrice; // We're selling to PancakeSwap
        realSpread =
          ((pancakeswapExecutionPrice - mexcExecutionPrice) /
            mexcExecutionPrice) *
          100;
      } else {
        // Buy on PancakeSwap, sell on MEXC
        pancakeswapExecutionPrice = currentPrices.pancakeswap.askPrice; // We're buying from PancakeSwap
        mexcExecutionPrice = currentPrices.mexc.bidPrice; // We're selling to MEXC
        realSpread =
          ((mexcExecutionPrice - pancakeswapExecutionPrice) /
            pancakeswapExecutionPrice) *
          100;
      }

      // Calculate REAL fees
      mexcFee = tradeSize * this.config.exchanges.mexc.fees.taker;
      pancakeswapFee = tradeSize * this.config.exchanges.pancakeswap.fees.swap;
      gasCost = pancakeQuote?.gasEstimate
        ? parseFloat(pancakeQuote.gasEstimate.gasLimit || '0') * 0.001
        : 0.01; // Fallback gas cost

      const totalFees = mexcFee + pancakeswapFee + gasCost;
      const grossProfit =
        opportunity.buyExchange === 'MEXC'
          ? (tradeSize * realSpread) / 100
          : (tradeSize * realSpread) / 100;
      realNetProfit = grossProfit - totalFees;

      const actualExecutionTime = Date.now() - startTime;

      // Log DETAILED simulation with REAL DATA
      this.logger.log(`🎯 [SIMULATION] ${tradeId} - REAL DATA ANALYSIS`, {
        component: 'ArbitrageService',
        tradeId,
        timestamp: new Date().toISOString(),

        // Trade Direction
        direction: `${opportunity.buyExchange} → ${opportunity.sellExchange}`,
        tradeSize: `${tradeSize.toFixed(2)} USDT`,

        // REAL Current Prices
        mexc: {
          bid: currentPrices.mexc.bidPrice.toFixed(6),
          ask: currentPrices.mexc.askPrice.toFixed(6),
          timestamp: currentPrices.mexc.timestamp.toISOString(),
          source: currentPrices.mexc.source,
        },
        pancakeswap: {
          bid: currentPrices.pancakeswap.bidPrice.toFixed(6),
          ask: currentPrices.pancakeswap.askPrice.toFixed(6),
          timestamp: currentPrices.pancakeswap.timestamp.toISOString(),
          source: currentPrices.pancakeswap.source,
        },

        // Execution Prices
        executionPrices: {
          mexc: mexcExecutionPrice.toFixed(6),
          pancakeswap: pancakeswapExecutionPrice.toFixed(6),
        },

        // Profit Analysis
        profitAnalysis: {
          realSpread: `${realSpread.toFixed(4)}%`,
          grossProfit: `${grossProfit.toFixed(4)} USDT`,
          fees: {
            mexc: `${mexcFee.toFixed(4)} USDT`,
            pancakeswap: `${pancakeswapFee.toFixed(4)} USDT`,
            gas: `${gasCost.toFixed(4)} USDT`,
            total: `${totalFees.toFixed(4)} USDT`,
          },
          netProfit: `${realNetProfit.toFixed(4)} USDT`,
          profitability:
            realNetProfit > 0 ? '✅ PROFITABLE' : '❌ UNPROFITABLE',
        },

        // Timing
        timing: {
          apiResponseTime: `${actualExecutionTime}ms`,
          priceDataAge: {
            mexc: `${Date.now() - currentPrices.mexc.timestamp.getTime()}ms`,
            pancakeswap: `${Date.now() - currentPrices.pancakeswap.timestamp.getTime()}ms`,
          },
        },

        // Live API Data (for comparison)
        liveApiData: {
          mexcBookTicker: mexcBook
            ? {
                bid: mexcBook.bidPrice,
                ask: mexcBook.askPrice,
              }
            : 'UNAVAILABLE',
          pancakeswapQuote: pancakeQuote
            ? {
                amountOut: pancakeQuote.amountOut,
                priceImpact: pancakeQuote.priceImpact,
                gasEstimate: pancakeQuote.gasEstimate,
              }
            : 'UNAVAILABLE',
        },
      });

      // Update virtual balances with REAL calculations
      if (opportunity.buyExchange === 'MEXC') {
        this.virtualBalance.usdt -= tradeSize;
        this.virtualBalance.ilmt += tradeSize / mexcExecutionPrice;
      } else {
        this.virtualBalance.ilmt -= tradeSize;
        this.virtualBalance.usdt += tradeSize * mexcExecutionPrice;
      }

      // Update virtual stats
      this.dailyStats.trades++;
      this.dailyStats.volume += tradeSize;
      this.dailyStats.profit += realNetProfit;
      this.dailyStats.fees += totalFees;

      // Log summary
      this.logger.log(
        `📊 [SIMULATION] ${tradeId} - Trade Summary: ${realNetProfit > 0 ? '✅ PROFIT' : '❌ LOSS'} ${realNetProfit.toFixed(4)} USDT`,
        {
          component: 'ArbitrageService',
          virtualBalances: {
            usdt: this.virtualBalance.usdt.toFixed(2),
            ilmt: this.virtualBalance.ilmt.toFixed(2),
            bnb: this.virtualBalance.bnb.toFixed(4),
          },
        },
      );
    } catch (error) {
      this.logger.error(`❌ [SIMULATION] ${tradeId} - Simulation failed`, {
        component: 'ArbitrageService',
        error: error instanceof Error ? error.message : String(error),
        tradeId,
      });
      this.dailyStats.rejectedTrades++;
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  private logMonitoringStats(): void {
    if (!this.isMonitoringMode) return;

    const totalVirtualValue =
      this.virtualBalance.usdt +
      this.virtualBalance.ilmt * this.getCurrentPrice();
    const initialValue = 2000; // Starting virtual balance
    const virtualROI =
      ((totalVirtualValue - initialValue) / initialValue) * 100;

    this.logger.log(`📊 [SIMULATION] Hourly Stats Report`, {
      component: 'ArbitrageService',
      period: 'HOURLY',
      mode: 'SIMULATION',
      stats: {
        virtualTrades: this.dailyStats.trades,
        virtualVolume: `${this.dailyStats.volume.toFixed(2)} USDT`,
        virtualProfit: `${this.dailyStats.profit.toFixed(2)} USDT`,
        rejectedTrades: this.dailyStats.rejectedTrades,
        opportunitiesDetected: this.dailyStats.opportunities,
        virtualPortfolioValue: `${totalVirtualValue.toFixed(2)} USDT`,
        virtualROI: `${virtualROI.toFixed(2)}%`,
        balances: {
          usdt: this.virtualBalance.usdt.toFixed(2),
          ilmt: this.virtualBalance.ilmt.toFixed(2),
          bnb: this.virtualBalance.bnb.toFixed(4),
        },
      },
    });
  }

  private getCurrentPrice(): number {
    // Get current price from price calculator
    const prices = this.priceCalculator.getCurrentPrices();
    return prices.mexc?.askPrice || 1.0;
  }

  @Cron('*/5 * * * * *') // Rulează la fiecare 5 secunde
  async performArbitrageCheck(): Promise<void> {
    if (!this.isBotEnabled || this.isProcessing) {
      return;
    }

          // 🔒 CHECK GLOBAL LOCK
    if (ArbitrageService.isGloballyExecuting) {
      this.loggingService.debug(
        '🔒 Skipping cron execution - another execution in progress',
        `Current execution: ${ArbitrageService.currentExecutionId}`,
      );
      return;
    }

    this.isProcessing = true;

    try {
      // Obține prețurile de la ambele exchange-uri
      const prices = this.priceCalculator.getCurrentPrices();
      
      if (!prices.mexc || !prices.pancakeswap) {
        this.loggingService.warn(
          '⚠️ Could not fetch prices from both exchanges',
        );
        return;
      }

      // Log current prices
      this.loggingService.info(
        `📊 CURRENT PRICES | MEXC: $${((prices.mexc.bidPrice + prices.mexc.askPrice) / 2).toFixed(6)} | PANCAKE: $${((prices.pancakeswap.bidPrice + prices.pancakeswap.askPrice) / 2).toFixed(6)}`,
        {
          component: 'ArbitrageService',
          mexcPrice: prices.mexc,
          pancakeswapPrice: prices.pancakeswap,
        },
      );

      // 🎯 QUEUE CRON EXECUTION with global lock
      await this.queueExecution(async () => {
        // **STRATEGIA OPTIMIZATĂ ILMT**: Analizează și execută strategia optimă
        const ilmtStrategy = await this.ilmtOptimizedStrategyService.analyzeOptimalStrategy(
          prices.mexc!,
          prices.pancakeswap!,
        );

        // Execută strategia ILMT
        const strategyExecuted = await this.ilmtOptimizedStrategyService.executeStrategy(ilmtStrategy);

        if (strategyExecuted) {
          const portfolio = this.ilmtOptimizedStrategyService.getCurrentPortfolio();
          this.loggingService.info(
            `✅ ILMT STRATEGY EXECUTED | Type: ${ilmtStrategy.type} | Expected Gain: $${ilmtStrategy.expectedUsdtGain.toFixed(4)} | Confidence: ${ilmtStrategy.confidence}`,
            {
              component: 'ArbitrageService',
              strategy: ilmtStrategy,
              portfolio: portfolio,
            },
          );

          // Emit event pentru monitoring
          this.eventEmitter.emit('arbitrage.strategy.executed', {
            type: 'ILMT_OPTIMIZED',
            strategy: ilmtStrategy,
            portfolio: portfolio,
            timestamp: new Date(),
          });
        }

        // **ARBITRAJ CLASIC**: Verifică oportunități de arbitraj tradiționale (backup)
        const arbitrageOpportunity = this.priceCalculator.getCurrentOpportunity();

        if (arbitrageOpportunity && arbitrageOpportunity.netProfitPercentage >= this.minProfitThreshold) {
          const direction = `${arbitrageOpportunity.buyExchange}_TO_${arbitrageOpportunity.sellExchange}`;
          this.loggingService.info(
            `🎯 CLASSIC ARBITRAGE OPPORTUNITY | ${direction} | Profit: ${arbitrageOpportunity.netProfitPercentage.toFixed(3)}% | Amount: $${arbitrageOpportunity.maxTradeSize.toFixed(2)}`,
            {
              component: 'ArbitrageService',
              opportunity: arbitrageOpportunity,
            },
          );

          // Execută arbitraj clasic doar dacă strategia ILMT nu a fost executată
          if (!strategyExecuted && this.shouldExecuteClassicArbitrage()) {
            await this.executor.executeArbitrage(arbitrageOpportunity, arbitrageOpportunity.maxTradeSize);
          }
        }
      }, 'cron-check');

    } catch (error) {
      this.loggingService.error(
        'Error in performArbitrageCheck',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      // ✅ IMPORTANT: Reset local processing flag
      this.isProcessing = false;
    }
  }

  /**
   * 🔒 GLOBAL EXECUTION QUEUE SYSTEM
   * Asigură că doar o execuție rulează la un moment dat
   */
  private async queueExecution(execution: () => Promise<void>, executionId: string): Promise<void> {
    // Check minimum interval between executions
    if (ArbitrageService.lastExecutionTime) {
      const timeSinceLastExecution = Date.now() - ArbitrageService.lastExecutionTime.getTime();
      if (timeSinceLastExecution < ArbitrageService.MIN_EXECUTION_INTERVAL) {
        this.loggingService.info(`⏸️ Execution too frequent - waiting ${ArbitrageService.MIN_EXECUTION_INTERVAL - timeSinceLastExecution}ms`, {
          component: 'ArbitrageService',
          executionId,
          timeSinceLastExecution,
        });
        return;
      }
    }

    // If already executing, skip this execution
    if (ArbitrageService.isGloballyExecuting) {
      this.loggingService.info(`🔒 Execution blocked - another execution in progress`, {
        component: 'ArbitrageService',
        executionId,
        currentExecution: ArbitrageService.currentExecutionId,
      });
      return;
    }

    // Acquire global lock
    ArbitrageService.isGloballyExecuting = true;
    ArbitrageService.currentExecutionId = executionId;
    ArbitrageService.lastExecutionTime = new Date();

    this.loggingService.info(`🔓 Starting execution`, {
      component: 'ArbitrageService',
      executionId,
      timestamp: new Date().toISOString(),
    });

    try {
      await execution();
    } catch (error) {
      this.loggingService.error(`❌ Execution failed: ${executionId}`, error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      // ✅ ALWAYS release global lock
      ArbitrageService.isGloballyExecuting = false;
      ArbitrageService.currentExecutionId = null;
      
      this.loggingService.info(`🔒 Execution completed and lock released`, {
        component: 'ArbitrageService',
        executionId,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Verifică dacă ar trebui să execute arbitraj clasic
   */
  private shouldExecuteClassicArbitrage(): boolean {
    const portfolio = this.ilmtOptimizedStrategyService.getCurrentPortfolio();
    
    // Execută arbitraj clasic doar dacă ai suficient USDT
    if (portfolio && portfolio.total.usdt < 50) {
      this.loggingService.info('📉 Skipping classic arbitrage - insufficient USDT balance');
      return false;
    }

    return true;
  }
}
