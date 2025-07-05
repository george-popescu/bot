import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ArbitrageOpportunity } from '../types/arbitrage.types';
import { EnvironmentVariables } from '../../config/validation.schema';
import { PriceCalculatorService } from './price-calculator.service';

export interface VirtualBalance {
  usdt: number;
  ilmt: number;
  bnb: number;
}

export interface MonitoringStats {
  trades: number;
  volume: number;
  profit: number;
  fees: number;
  opportunities: number;
  rejectedTrades: number;
  startTime: Date;
}

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);
  private isMonitoringMode: boolean;

  private virtualBalance: VirtualBalance = {
    usdt: 1000, // Virtual starting balance
    ilmt: 1000,
    bnb: 1,
  };

  private stats: MonitoringStats = {
    trades: 0,
    volume: 0,
    profit: 0,
    fees: 0,
    opportunities: 0,
    rejectedTrades: 0,
    startTime: new Date(),
  };

  constructor(
    private readonly configService: ConfigService<EnvironmentVariables>,
    @Inject(forwardRef(() => PriceCalculatorService))
    private readonly priceCalculator: PriceCalculatorService,
  ) {
    this.isMonitoringMode =
      this.configService.get<boolean>('MONITORING_MODE') ?? true;

    if (this.isMonitoringMode) {
      this.logger.warn('🔍 MONITORING MODE ENABLED - Virtual trading active');
    }
  }

  async simulateArbitrage(opportunity: ArbitrageOpportunity): Promise<void> {
    if (!this.isMonitoringMode) {
      return;
    }

    const tradeId = `monitor_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Use REAL risk management calculations - same as live trading
    const maxConfigTradeSize =
      this.configService.get<number>('MAX_TRADE_SIZE') || 500;
    const maxDailyVolume =
      this.configService.get<number>('MAX_DAILY_VOLUME') || 5000;
    const remainingDailyVolume = maxDailyVolume - this.stats.volume;

    // Calculate trade size using REAL bot logic
    let tradeSize = Math.min(
      opportunity.maxTradeSize, // Opportunity-based limit
      maxConfigTradeSize, // Configuration limit
      remainingDailyVolume, // Daily volume limit
    );

    // Apply confidence-based sizing (same as real bot)
    switch (opportunity.confidence) {
      case 'HIGH':
        tradeSize *= 1.0;
        break;
      case 'MEDIUM':
        tradeSize *= 0.7;
        break;
      case 'LOW':
        tradeSize *= 0.5;
        break;
    }

    // Apply risk-based sizing (same as real bot)
    switch (opportunity.riskLevel) {
      case 'LOW':
        tradeSize *= 1.0;
        break;
      case 'MEDIUM':
        tradeSize *= 0.8;
        break;
      case 'HIGH':
        tradeSize *= 0.5;
        break;
    }

    tradeSize = Math.floor(tradeSize);
    const estimatedProfit = opportunity.netProfit * (tradeSize / 100); // Scale from $100 base calculation

    // Determine direction from buy/sell exchanges
    const isBuyMexc = opportunity.buyExchange === 'MEXC';

    // Virtual balance check
    if (isBuyMexc) {
      // Buy on MEXC, sell on PancakeSwap
      if (this.virtualBalance.usdt < tradeSize) {
        this.logger.warn(
          `🚫 [MONITORING] ${tradeId} - Insufficient virtual USDT balance`,
        );
        this.stats.rejectedTrades++;
        return;
      }
    } else {
      // Buy on PancakeSwap, sell on MEXC
      if (this.virtualBalance.ilmt < tradeSize) {
        this.logger.warn(
          `🚫 [MONITORING] ${tradeId} - Insufficient virtual ILMT balance`,
        );
        this.stats.rejectedTrades++;
        return;
      }
    }

    // No artificial delays - use real API timing only
    // (Execution timing is measured when actual APIs are called)

    // Update virtual balances
    if (isBuyMexc) {
      this.virtualBalance.usdt -= tradeSize;
      this.virtualBalance.ilmt += tradeSize / opportunity.buyPrice;
    } else {
      this.virtualBalance.ilmt -= tradeSize;
      this.virtualBalance.usdt += tradeSize * opportunity.sellPrice;
    }

    // Log detailed monitoring information
    this.logger.log(`📊 [MONITORING] VIRTUAL TRADE EXECUTED`);
    this.logger.log(`🆔 Trade ID: ${tradeId}`);
    this.logger.log(
      `🎯 Direction: ${opportunity.buyExchange} → ${opportunity.sellExchange}`,
    );
    this.logger.log(`💰 Trade Size: ${tradeSize} USDT`);
    this.logger.log(`📈 Spread: ${opportunity.spreadPercentage.toFixed(2)}%`);
    this.logger.log(`💎 Estimated Profit: ${estimatedProfit.toFixed(2)} USDT`);
    this.logger.log(
      `🏦 Virtual Balances - USDT: ${this.virtualBalance.usdt.toFixed(2)}, ILMT: ${this.virtualBalance.ilmt.toFixed(2)}`,
    );

    // Update stats
    this.stats.trades++;
    this.stats.volume += tradeSize;
    this.stats.profit += estimatedProfit;
    this.stats.fees += tradeSize * 0.003; // Estimated fees

    this.logTradeAction(opportunity, tradeSize, estimatedProfit);
  }

  logOpportunity(opportunity: ArbitrageOpportunity): void {
    if (!this.isMonitoringMode) {
      return;
    }

    this.stats.opportunities++;

    this.logger.log(`🎯 [MONITORING] OPPORTUNITY DETECTED`);
    this.logger.log(
      `📊 Buy Exchange: ${opportunity.buyExchange} - Price: ${opportunity.buyPrice.toFixed(6)} USDT`,
    );
    this.logger.log(
      `🥞 Sell Exchange: ${opportunity.sellExchange} - Price: ${opportunity.sellPrice.toFixed(6)} USDT`,
    );
    this.logger.log(`📈 Spread: ${opportunity.spreadPercentage.toFixed(2)}%`);
    this.logger.log(
      `🎯 Direction: ${opportunity.buyExchange} → ${opportunity.sellExchange}`,
    );
    this.logger.log(
      `💰 Max Trade Size: ${opportunity.maxTradeSize.toFixed(2)} USDT`,
    );
    this.logger.log(
      `💎 Estimated Profit: ${opportunity.estimatedProfit.toFixed(2)} USDT`,
    );

    if (opportunity.spreadPercentage > 1.0) {
      this.logger.log(`✅ PROFITABLE - Would execute trade`);
    } else {
      this.logger.log(`❌ NOT PROFITABLE - Would skip trade`);
    }
  }

  private logTradeAction(
    opportunity: ArbitrageOpportunity,
    tradeSize: number,
    profit: number,
  ): void {
    const action = `Buy ILMT on ${opportunity.buyExchange} → Sell on ${opportunity.sellExchange}`;

    this.logger.log(`🚀 [MONITORING] ACTION: ${action}`);
    this.logger.log(`💵 Trade Size: ${tradeSize} USDT`);
    this.logger.log(`💰 Expected Profit: ${profit.toFixed(2)} USDT`);
    this.logger.log(`📊 ROI: ${((profit / tradeSize) * 100).toFixed(2)}%`);
  }

  @Cron(CronExpression.EVERY_HOUR)
  private logHourlyStats(): void {
    if (!this.isMonitoringMode) return;

    // Get REAL current price - no assumptions!
    let currentPrice: number | null = null;
    try {
      const prices = this.priceCalculator.getCurrentPrices();
      if (prices.mexc?.askPrice) {
        currentPrice = prices.mexc.askPrice;
      } else if (prices.pancakeswap?.askPrice) {
        currentPrice = prices.pancakeswap.askPrice;
      }
    } catch (error) {
      this.logger.error('Failed to get real price for monitoring stats', {
        error,
      });
    }

    if (currentPrice === null) {
      this.logger.warn(
        'No real price data available - skipping portfolio calculation',
      );
      return;
    }
    const totalVirtualValue =
      this.virtualBalance.usdt + this.virtualBalance.ilmt * currentPrice;
    const initialValue = 2000; // Starting virtual balance
    const virtualROI =
      ((totalVirtualValue - initialValue) / initialValue) * 100;
    const uptimeHours =
      (Date.now() - this.stats.startTime.getTime()) / (1000 * 60 * 60);

    this.logger.log(
      `📊 [MONITORING] ========== HOURLY STATS REPORT ==========`,
    );
    this.logger.log(`⏰ Uptime: ${uptimeHours.toFixed(1)} hours`);
    this.logger.log(
      `💰 Current ILMT Price: ${currentPrice.toFixed(6)} USDT (REAL DATA)`,
    );
    this.logger.log(`🎯 Virtual Trades: ${this.stats.trades}`);
    this.logger.log(`📈 Virtual Volume: ${this.stats.volume.toFixed(2)} USDT`);
    this.logger.log(`💰 Virtual Profit: ${this.stats.profit.toFixed(2)} USDT`);
    this.logger.log(`💸 Virtual Fees: ${this.stats.fees.toFixed(2)} USDT`);
    this.logger.log(`🚫 Rejected Trades: ${this.stats.rejectedTrades}`);
    this.logger.log(`📊 Opportunities Detected: ${this.stats.opportunities}`);
    this.logger.log(
      `🏦 Virtual Portfolio Value: ${totalVirtualValue.toFixed(2)} USDT (REAL CALCULATION)`,
    );
    this.logger.log(`📈 Virtual ROI: ${virtualROI.toFixed(2)}%`);
    this.logger.log(
      `⚡ Average Profit per Trade: ${(this.stats.profit / Math.max(this.stats.trades, 1)).toFixed(2)} USDT`,
    );
    this.logger.log(
      `📊 Success Rate: ${((this.stats.trades / Math.max(this.stats.opportunities, 1)) * 100).toFixed(1)}%`,
    );
    this.logger.log(`=========================================`);
  }

  getMonitoringStats(): MonitoringStats & {
    virtualBalance: VirtualBalance;
    currentPrice: number | null;
  } {
    const currentPrice = this.getCurrentRealPrice();
    return {
      ...this.stats,
      virtualBalance: { ...this.virtualBalance },
      currentPrice,
    };
  }

  private getCurrentRealPrice(): number | null {
    try {
      const prices = this.priceCalculator.getCurrentPrices();
      if (prices.mexc?.askPrice) {
        return prices.mexc.askPrice;
      } else if (prices.pancakeswap?.askPrice) {
        return prices.pancakeswap.askPrice;
      }
    } catch (error) {
      this.logger.error('Failed to get real price', { error });
    }
    return null;
  }

  resetStats(): void {
    this.stats = {
      trades: 0,
      volume: 0,
      profit: 0,
      fees: 0,
      opportunities: 0,
      rejectedTrades: 0,
      startTime: new Date(),
    };

    this.virtualBalance = {
      usdt: 1000,
      ilmt: 1000,
      bnb: 1,
    };

    this.logger.log('🔄 [MONITORING] Stats reset');
  }
}
