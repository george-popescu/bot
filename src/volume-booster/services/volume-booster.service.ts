/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';
import { LoggingService } from '../../logging/logging.service';
import { MexcApiService } from '../../mexc/services/mexc-api.service';
import { formatMexcQuantity } from '../../mexc/utils/mexc-formatting.utils';

export enum VolumeStrategy {
  RANDOM = 'RANDOM', // Random BUY/SELL (current)
  BALANCED = 'BALANCED', // Strict balance between BUY/SELL
  SMART_SPREAD = 'SMART_SPREAD', // BUY at bid, SELL at ask
  BUY_HEAVY = 'BUY_HEAVY', // 70% BUY, 30% SELL
  SELL_HEAVY = 'SELL_HEAVY', // 30% BUY, 70% SELL
  ALTERNATING = 'ALTERNATING', // Strict BUY -> SELL -> BUY pattern
}

export interface VolumeBoosterConfig {
  enabled: boolean;
  monitoringMode: boolean;
  targetVolumeDaily: number;
  minTradeSize: number;
  maxTradeSize: number;
  cycleIntervalMin: number;
  cycleIntervalMax: number;
  stealthMode: boolean;
  strategy: VolumeStrategy;
  balanceWindow: number; // Window for checking balance (number of trades)
  priceImpactLimit: number; // Max acceptable price impact %
  useSpreadTrading: boolean; // Use bid/ask spread for zero impact
  maxConsecutiveSide: number; // Max consecutive BUY or SELL orders
}

export interface TradeRecord {
  side: 'BUY' | 'SELL';
  size: number;
  timestamp: Date;
  price: number;
}

export interface VolumeStats {
  dailyVolume: number;
  dailyTrades: number;
  lastTradeTime: Date | null;
  buyCount: number;
  sellCount: number;
  consecutiveBuy: number;
  consecutiveSell: number;
  recentTrades: TradeRecord[];
}

@Injectable()
export class VolumeBoosterService {
  private isRunning = false;
  private config: VolumeBoosterConfig = {
    enabled: false,
    monitoringMode: true,
    targetVolumeDaily: 1000,
    minTradeSize: 150,
    maxTradeSize: 300,
    cycleIntervalMin: 60,
    cycleIntervalMax: 300,
    stealthMode: true,
    strategy: VolumeStrategy.BALANCED,
    balanceWindow: 20,
    priceImpactLimit: 0.5,
    useSpreadTrading: false,
    maxConsecutiveSide: 3,
  };

  private stats: VolumeStats = {
    dailyVolume: 0,
    dailyTrades: 0,
    lastTradeTime: null,
    buyCount: 0,
    sellCount: 0,
    consecutiveBuy: 0,
    consecutiveSell: 0,
    recentTrades: [],
  };

  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly loggingService: LoggingService,
    private readonly mexcApiService: MexcApiService,
  ) {
    console.log('🔧 VolumeBoosterService constructor called');
    console.log('🔍 Initializing Volume Booster configuration...');
    this.initializeConfig();
    console.log('✅ Volume Booster configuration initialized:', this.config);
  }

  private initializeConfig(): void {
    const vbConfig = this.configService.volumeBoosterConfig;

    // Safe defaults with conservative values
    this.config = {
      enabled: vbConfig.enabled || false,
      monitoringMode: vbConfig.monitoringMode !== false, // Default true for safety
      targetVolumeDaily: vbConfig.targetVolumeDaily || 1000, // $1K conservative
      minTradeSize: Math.max(vbConfig.minTradeSize || 150, 150), // MEXC minimum
      maxTradeSize: Math.min(vbConfig.maxTradeSize || 300, 500), // Conservative max
      cycleIntervalMin: vbConfig.cycleIntervalMin || 60, // 1 minute minimum
      cycleIntervalMax: vbConfig.cycleIntervalMax || 300, // 5 minutes maximum
      stealthMode: vbConfig.stealthMode !== false, // Default true
      strategy:
        (vbConfig.strategy as VolumeStrategy) || VolumeStrategy.BALANCED, // Default BALANCED
      balanceWindow: vbConfig.balanceWindow || 20, // Check last 20 trades for balance
      priceImpactLimit: vbConfig.priceImpactLimit || 0.5, // 0.5% max impact
      useSpreadTrading: vbConfig.useSpreadTrading !== false, // Default true for zero impact
      maxConsecutiveSide: vbConfig.maxConsecutiveSide || 3, // Max 3 consecutive same side
    };
  }

  async start(): Promise<void> {
    console.log('🎬 Volume Booster start() method called');
    console.log('📊 Current running status:', this.isRunning);
    console.log('⚙️ Configuration enabled:', this.config.enabled);
    console.log('🔒 Monitoring mode:', this.config.monitoringMode);

    if (this.isRunning) {
      console.log('⚠️ Volume Booster is already running - returning early');
      this.loggingService.warn('Volume Booster is already running');
      return;
    }

    if (!this.config.enabled) {
      console.log(
        '🚫 Volume Booster is disabled in configuration - returning early',
      );
      this.loggingService.warn('Volume Booster is disabled in configuration');
      return;
    }

    console.log('✅ All checks passed - proceeding with startup');
    this.loggingService.info('🚀 Starting Volume Booster', {
      component: 'VolumeBoosterService',
      config: this.config,
      monitoringMode: this.config.monitoringMode,
    });

    this.isRunning = true;
    console.log('🔄 Setting isRunning = true and scheduling first cycle');
    this.scheduleNextCycle();
    console.log('✅ Volume Booster startup completed - first cycle scheduled');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      this.loggingService.warn('Volume Booster is not running');
      return;
    }

    this.loggingService.info('⏹️ Stopping Volume Booster');
    this.isRunning = false;

    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.intervalId = null;
    }
  }

  getStatus(): {
    isRunning: boolean;
    config: VolumeBoosterConfig;
    stats: VolumeStats;
  } {
    return {
      isRunning: this.isRunning,
      config: this.config,
      stats: this.stats,
    };
  }

  private async runVolumeBoostCycle(): Promise<void> {
    if (!this.isRunning) return;

    try {
      this.loggingService.info('🔄 Running Volume Boost cycle');

      if (this.config.monitoringMode) {
        await this.simulateVolumeBoost();
      } else {
        await this.executeVolumeBoost();
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.loggingService.error(`Volume Boost cycle error: ${errorMessage}`);
    }

    this.scheduleNextCycle();
  }

  private async simulateVolumeBoost(): Promise<void> {
    console.log('🎭 Starting volume boost simulation...');

    console.log('📊 Calculating trade size...');
    const tradeSize = this.calculateTradeSize();
    console.log('✅ Trade size calculated:', tradeSize, 'ILMT');

    console.log('🎯 Calculating trade side using strategy...');
    const tradeSide = await this.calculateTradeSide();
    console.log('✅ Trade side calculated:', tradeSide);

    console.log('💰 Getting current ILMT price...');
    const currentPrice = await this.getCurrentPrice();
    console.log('✅ Current price retrieved:', currentPrice);

    if (!currentPrice) {
      console.log('❌ Failed to get current price - aborting simulation');
      this.loggingService.warn('Cannot get current price for simulation');
      return;
    }

    const tradeValue = tradeSize * currentPrice;
    console.log('💵 Calculated trade value:', tradeValue, 'USD');

    console.log('📈 Recording simulated trade...');
    await this.recordTrade(tradeSide, tradeSize, currentPrice);

    console.log('📈 Updating daily statistics...');
    this.stats.dailyVolume += tradeValue;
    this.stats.dailyTrades += 1;
    this.stats.lastTradeTime = new Date();
    console.log('✅ Statistics updated:', this.stats);

    console.log(
      `🎭 [SIMULATION] Volume boost trade executed successfully! ${tradeSide} ${tradeSize} ILMT @ $${currentPrice}`,
    );
    this.loggingService.info('🎭 [SIMULATION] Volume boost trade', {
      component: 'VolumeBoosterService',
      side: tradeSide,
      tradeSize,
      currentPrice,
      tradeValue,
      strategy: this.config.strategy,
      stats: this.stats,
    });
  }

  private async executeVolumeBoost(): Promise<void> {
    const tradeSize = this.calculateTradeSize();
    const tradeSide = await this.calculateTradeSide();

    console.log(
      `💡 Strategy: ${this.config.strategy}, Calculated side: ${tradeSide}, Size: ${tradeSize} ILMT`,
    );

    try {
      // Execute market order for speed (anti-front-running)
      const order = await this.mexcApiService.placeOrder({
        symbol: 'ILMTUSDT',
        side: tradeSide,
        type: 'MARKET',
        quantity: formatMexcQuantity(tradeSize),
      });

      // Record the trade
      await this.recordTrade(
        tradeSide,
        tradeSize,
        parseFloat(order.price || '0.009'),
      );

      this.loggingService.info('🎯 Volume boost trade executed', {
        orderId: order.orderId,
        side: tradeSide,
        size: tradeSize,
        strategy: this.config.strategy,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.loggingService.error(`Volume boost trade failed: ${errorMessage}`);
    }
  }

  private calculateTradeSize(): number {
    const min = this.config.minTradeSize;
    const max = this.config.maxTradeSize;

    // Random size between min and max for stealth
    return Math.round(min + Math.random() * (max - min));
  }

  private async getCurrentPrice(): Promise<number | null> {
    try {
      const ticker = await this.mexcApiService.getBookTicker('ILMTUSDT');
      const bidPrice = parseFloat(ticker.bidPrice);
      const askPrice = parseFloat(ticker.askPrice);
      return (bidPrice + askPrice) / 2;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.loggingService.error(`Failed to get current price: ${errorMessage}`);
      return null;
    }
  }

  private scheduleNextCycle(): void {
    console.log(
      '⏰ scheduleNextCycle() called, checking if running:',
      this.isRunning,
    );
    if (!this.isRunning) {
      console.log('🛑 Not running - skipping cycle scheduling');
      return;
    }

    const minInterval = this.config.cycleIntervalMin * 1000;
    const maxInterval = this.config.cycleIntervalMax * 1000;
    const randomInterval =
      minInterval + Math.random() * (maxInterval - minInterval);

    console.log(
      `⏱️ Scheduling next cycle in ${Math.round(randomInterval / 1000)}s (${minInterval}ms - ${maxInterval}ms range)`,
    );

    this.intervalId = setTimeout(() => {
      console.log('🔥 Volume boost cycle timer fired!');
      if (this.isRunning) {
        console.log('✅ Still running - executing volume boost cycle');
        this.runVolumeBoostCycle().catch((error) => {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          console.log('❌ Error in volume boost cycle:', errorMessage);
          this.loggingService.error(
            `Error in volume boost cycle: ${errorMessage}`,
          );
        });
      } else {
        console.log('⏹️ Not running anymore - skipping cycle');
      }
    }, randomInterval);

    // console.log(`✅ Next cycle scheduled with timeout ID:`, this.intervalId);
    this.loggingService.debug(
      `Next volume boost cycle in ${Math.round(randomInterval / 1000)}s`,
    );
  }

  /**
   * Calculate trade side based on strategy
   */
  private async calculateTradeSide(): Promise<'BUY' | 'SELL'> {
    console.log(
      `🎯 Calculating trade side using strategy: ${this.config.strategy}`,
    );

    switch (this.config.strategy) {
      case VolumeStrategy.RANDOM:
        return Math.random() > 0.5 ? 'BUY' : 'SELL';

      case VolumeStrategy.BALANCED:
        return this.calculateBalancedSide();

      case VolumeStrategy.ALTERNATING:
        return this.calculateAlternatingSide();

      case VolumeStrategy.BUY_HEAVY:
        return Math.random() > 0.3 ? 'BUY' : 'SELL'; // 70% BUY

      case VolumeStrategy.SELL_HEAVY:
        return Math.random() > 0.7 ? 'BUY' : 'SELL'; // 30% BUY

      case VolumeStrategy.SMART_SPREAD:
        return await this.calculateSmartSpreadSide();

      default:
        console.log('⚠️ Unknown strategy, defaulting to BALANCED');
        return this.calculateBalancedSide();
    }
  }

  /**
   * Calculate balanced side to maintain 50/50 BUY/SELL ratio
   */
  private calculateBalancedSide(): 'BUY' | 'SELL' {
    const buyCount = this.stats.buyCount;
    const sellCount = this.stats.sellCount;
    const consecutiveBuy = this.stats.consecutiveBuy;
    const consecutiveSell = this.stats.consecutiveSell;

    console.log(
      `📊 Balance check - BUY: ${buyCount}, SELL: ${sellCount}, Consecutive BUY: ${consecutiveBuy}, Consecutive SELL: ${consecutiveSell}`,
    );

    // Avoid too many consecutive same side orders
    if (consecutiveBuy >= this.config.maxConsecutiveSide) {
      console.log('🔄 Too many consecutive BUY orders, forcing SELL');
      return 'SELL';
    }

    if (consecutiveSell >= this.config.maxConsecutiveSide) {
      console.log('🔄 Too many consecutive SELL orders, forcing BUY');
      return 'BUY';
    }

    // Balance based on recent trade history
    if (buyCount > sellCount + 2) {
      console.log('⚖️ Too many BUY orders, balancing with SELL');
      return 'SELL';
    }

    if (sellCount > buyCount + 2) {
      console.log('⚖️ Too many SELL orders, balancing with BUY');
      return 'BUY';
    }

    // Random if balanced
    const side = Math.random() > 0.5 ? 'BUY' : 'SELL';
    console.log(`🎲 Balanced state, random choice: ${side}`);
    return side;
  }

  /**
   * Calculate alternating side
   */
  private calculateAlternatingSide(): 'BUY' | 'SELL' {
    const lastTrade =
      this.stats.recentTrades[this.stats.recentTrades.length - 1];

    if (!lastTrade) {
      console.log('🔄 No previous trades, starting with BUY');
      return 'BUY';
    }

    const oppositeSide = lastTrade.side === 'BUY' ? 'SELL' : 'BUY';
    console.log(
      `🔄 Alternating: last was ${lastTrade.side}, choosing ${oppositeSide}`,
    );
    return oppositeSide;
  }

  /**
   * Calculate smart spread side (buy at bid, sell at ask for zero impact)
   */
  private async calculateSmartSpreadSide(): Promise<'BUY' | 'SELL'> {
    try {
      const ticker = await this.mexcApiService.getBookTicker('ILMTUSDT');
      const spread = parseFloat(ticker.askPrice) - parseFloat(ticker.bidPrice);
      const spreadPercent = (spread / parseFloat(ticker.bidPrice)) * 100;

      console.log(
        `📈 Spread analysis: ${spread.toFixed(6)} USDT (${spreadPercent.toFixed(3)}%)`,
      );

      // If spread is tight, prefer alternating to avoid impact
      if (spreadPercent < 0.1) {
        console.log('🔒 Tight spread, using alternating strategy');
        return this.calculateAlternatingSide();
      }

      // Otherwise, use balanced approach
      return this.calculateBalancedSide();
    } catch (error) {
      console.log('❌ Error getting spread data, falling back to balanced');
      return this.calculateBalancedSide();
    }
  }

  /**
   * Record trade for tracking and strategy decisions
   */
  private async recordTrade(
    side: 'BUY' | 'SELL',
    size: number,
    price: number,
  ): Promise<void> {
    const trade: TradeRecord = {
      side,
      size,
      price,
      timestamp: new Date(),
    };

    console.log(`📝 Recording trade: ${side} ${size} ILMT @ ${price}`);

    // Update trade counts
    if (side === 'BUY') {
      this.stats.buyCount++;
      this.stats.consecutiveBuy++;
      this.stats.consecutiveSell = 0;
    } else {
      this.stats.sellCount++;
      this.stats.consecutiveSell++;
      this.stats.consecutiveBuy = 0;
    }

    // Add to recent trades (keep only last balanceWindow trades)
    this.stats.recentTrades.push(trade);
    if (this.stats.recentTrades.length > this.config.balanceWindow) {
      this.stats.recentTrades.shift();
    }

    console.log(
      `📊 Updated stats - BUY: ${this.stats.buyCount}, SELL: ${this.stats.sellCount}, Recent trades: ${this.stats.recentTrades.length}`,
    );
  }
}
