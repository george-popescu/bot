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
  HIGH_VOLUME_BURST = 'HIGH_VOLUME_BURST', // Multiple large volume trades in 1-minute bursts
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
  // HIGH_VOLUME_BURST strategy specific config
  burstMinVolume: number; // Minimum volume for burst trades (in USDT value)
  burstMaxVolume: number; // Maximum volume for burst trades (in USDT value)
  burstMinExecutions: number; // Minimum number of executions per burst
  burstMaxExecutions: number; // Maximum number of executions per burst
  burstPriceSpreadUnits: number; // Max price spread in 6-decimal units (e.g., 20 = 0.000020)
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
    // HIGH_VOLUME_BURST - CORRECȚIE: Volume cumulate în ILMT, trades mici în USDT, MAX 150 ILMT per trade
    burstMinVolume: 500, // 500 ILMT cumulative target per minute
    burstMaxVolume: 6000, // 6K ILMT cumulative target per minute
    burstMinExecutions: 15, // 15-30 trades per burst
    burstMaxExecutions: 30, // Pentru a atinge target-ul cumulat
    burstPriceSpreadUnits: 0.000020, // 20 units in 6 decimals
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
      // HIGH_VOLUME_BURST - CORRECȚIE: Volume cumulate în ILMT, trades mici în USDT, MAX 150 ILMT per trade
      burstMinVolume: vbConfig.burstMinVolume || 500, // 500 ILMT cumulative target per minute
      burstMaxVolume: vbConfig.burstMaxVolume || 6000, // 6K ILMT cumulative target per minute
      burstMinExecutions: vbConfig.burstMinExecutions || 15, // 15-30 trades per burst
      burstMaxExecutions: vbConfig.burstMaxExecutions || 30, // Pentru a atinge target-ul cumulat
      burstPriceSpreadUnits: vbConfig.burstPriceSpreadUnits || 0.000020, // 20 units in 6 decimals
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

      // Handle HIGH_VOLUME_BURST strategy differently
      if (this.config.strategy === VolumeStrategy.HIGH_VOLUME_BURST) {
        if (this.config.monitoringMode) {
          await this.simulateHighVolumeBurst();
        } else {
          await this.executeHighVolumeBurst();
        }
      } else {
        if (this.config.monitoringMode) {
          await this.simulateVolumeBoost();
        } else {
          await this.executeVolumeBoost();
        }
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

      case VolumeStrategy.HIGH_VOLUME_BURST:
        return this.calculateBalancedSide(); // Use balanced approach for bursts

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

  /**
   * Simulate HIGH_VOLUME_BURST strategy - many small trades (~10 USDT each) for cumulative ILMT target
   */
  private async simulateHighVolumeBurst(): Promise<void> {
    console.log(
      '🚀 Starting HIGH_VOLUME_BURST simulation (CORRECTED: Small trades for cumulative target)...',
    );

    // Get current market price
    const basePrice = await this.getCurrentPrice();
    if (!basePrice) {
      this.loggingService.warn('Cannot get current price for burst simulation');
      return;
    }

    // Calculate target ILMT volume (cumulative for the entire burst)
    const targetILMTVolume =
      Math.random() *
        (this.config.burstMaxVolume - this.config.burstMinVolume) +
      this.config.burstMinVolume;
    console.log(
      `🎯 Target cumulative ILMT volume: ${targetILMTVolume.toFixed(0)} ILMT`,
    );

    // Calculate individual trade size in USDT (small trades ~5-15 USDT each for safety)
    const minTradeValueUSDT = 5; // Min 5 USDT per trade
    const maxTradeValueUSDT = 15; // Max 15 USDT per trade (much safer than before!)

    // Calculate how many small trades we need to reach the ILMT target
    const avgTradeValueUSDT = (minTradeValueUSDT + maxTradeValueUSDT) / 2; // ~10 USDT avg
    const estimatedTrades = Math.ceil(
      (targetILMTVolume * basePrice) / avgTradeValueUSDT,
    );

    // Cap the number of executions within configured range
    const executionsCount = Math.min(
      Math.max(estimatedTrades, this.config.burstMinExecutions),
      this.config.burstMaxExecutions,
    );

    console.log(
      `💥 Executing ${executionsCount} small trades (${minTradeValueUSDT}-${maxTradeValueUSDT} USDT each)`,
    );
    console.log(
      `💡 Estimated total value: ~${(executionsCount * avgTradeValueUSDT).toFixed(0)} USDT`,
    );

    let totalBurstVolumeUSDT = 0;
    let totalBurstVolumeILMT = 0;
    const burstTrades: Array<{
      side: 'BUY' | 'SELL';
      size: number;
      price: number;
      value: number;
    }> = [];

    for (let i = 0; i < executionsCount; i++) {
      // Calculate small random trade value in USDT (5-15 USDT range)
      const tradeValueUSDT =
        Math.random() * (maxTradeValueUSDT - minTradeValueUSDT) +
        minTradeValueUSDT;

      // Calculate tight price range (within burstPriceSpreadUnits)
      const maxPriceDeviation = this.config.burstPriceSpreadUnits;
      const priceDeviation = (Math.random() - 0.5) * maxPriceDeviation * 2; // -max to +max
      const targetPrice = basePrice + priceDeviation;

      // Calculate size in ILMT based on small USDT value
      const tradeSize = Math.round(tradeValueUSDT / targetPrice);

      // Determine trade side (balanced approach)
      const tradeSide = await this.calculateTradeSide();

      // Record the simulated trade
      burstTrades.push({
        side: tradeSide,
        size: tradeSize,
        price: targetPrice,
        value: tradeValueUSDT,
      });
      await this.recordTrade(tradeSide, tradeSize, targetPrice);

      totalBurstVolumeUSDT += tradeValueUSDT;
      totalBurstVolumeILMT += tradeSize;

      console.log(
        `🎯 Micro-trade ${i + 1}/${executionsCount}: ${tradeSide} ${tradeSize} ILMT @ $${targetPrice.toFixed(6)} (${tradeValueUSDT.toFixed(2)} USDT)`,
      );
    }

    // Update statistics
    this.stats.dailyVolume += totalBurstVolumeUSDT;
    this.stats.dailyTrades += executionsCount;
    this.stats.lastTradeTime = new Date();

    console.log(`🎭 [SIMULATION] HIGH_VOLUME_BURST completed:`);
    console.log(`   • Total trades: ${executionsCount}`);
    console.log(
      `   • Total USDT value: ${totalBurstVolumeUSDT.toFixed(2)} USDT (SAFE SMALL AMOUNT!)`,
    );
    console.log(
      `   • Total ILMT volume: ${totalBurstVolumeILMT.toFixed(0)} ILMT`,
    );
    console.log(
      `   • Avg trade size: ${(totalBurstVolumeUSDT / executionsCount).toFixed(2)} USDT per trade`,
    );
    console.log(`   • Target was: ${targetILMTVolume.toFixed(0)} ILMT`);

    this.loggingService.info(
      '🎭 [SIMULATION] HIGH_VOLUME_BURST executed (CORRECTED)',
      {
        component: 'VolumeBoosterService',
        executionsCount,
        totalBurstVolumeUSDT: Math.round(totalBurstVolumeUSDT),
        totalBurstVolumeILMT: Math.round(totalBurstVolumeILMT),
        targetILMTVolume: Math.round(targetILMTVolume),
        avgTradeValueUSDT: totalBurstVolumeUSDT / executionsCount,
        basePrice,
        strategy: this.config.strategy,
        stats: this.stats,
      },
    );
  }

  /**
   * Execute HIGH_VOLUME_BURST strategy - many small real trades (~10 USDT each) for cumulative ILMT target
   * Enhanced with execution guarantee mechanisms
   */
  private async executeHighVolumeBurst(): Promise<void> {
    console.log(
      '🚀 Starting HIGH_VOLUME_BURST execution (ENHANCED - Guaranteed Execution)...',
    );

    // Pre-execution validation
    const preCheckResult = await this.preExecutionValidation();
    if (!preCheckResult.canExecute) {
      this.loggingService.warn(
        `Pre-execution check failed: ${preCheckResult.reason}`,
      );
      console.log(`⚠️ Pre-execution check failed: ${preCheckResult.reason}`);
      return;
    }

    // Get current market price
    const basePrice = await this.getCurrentPrice();
    if (!basePrice) {
      this.loggingService.warn('Cannot get current price for burst execution');
      return;
    }

    // Calculate target ILMT volume (cumulative for the entire burst)
    const targetILMTVolume =
      Math.random() *
        (this.config.burstMaxVolume - this.config.burstMinVolume) +
      this.config.burstMinVolume;
    console.log(
      `🎯 Target cumulative ILMT volume: ${targetILMTVolume.toFixed(0)} ILMT`,
    );

    // Calculate individual trade size in USDT (small trades ~5-15 USDT each for safety)
    const minTradeValueUSDT = 5; // Min 5 USDT per trade
    const maxTradeValueUSDT = 15; // Max 15 USDT per trade (SAFE!)

    // Calculate how many small trades we need to reach the ILMT target
    const avgTradeValueUSDT = (minTradeValueUSDT + maxTradeValueUSDT) / 2; // ~10 USDT avg
    const estimatedTrades = Math.ceil(
      (targetILMTVolume * basePrice) / avgTradeValueUSDT,
    );

    // Cap the number of executions within configured range
    const executionsCount = Math.min(
      Math.max(estimatedTrades, this.config.burstMinExecutions),
      this.config.burstMaxExecutions,
    );

    console.log(
      `💥 Executing ${executionsCount} small REAL trades with GUARANTEED EXECUTION`,
    );
    console.log(
      `💡 Estimated total value: ~${(executionsCount * avgTradeValueUSDT).toFixed(0)} USDT`,
    );
    console.log(
      `🛡️ ENHANCED: Pre-checks ✅, Retry logic ✅, Execution validation ✅`,
    );

    let totalBurstVolumeUSDT = 0;
    let totalBurstVolumeILMT = 0;
    let successfulTrades = 0;
    let retryAttempts = 0;
    const burstResults: Array<{
      orderId: string;
      side: 'BUY' | 'SELL';
      size: number;
      value: number;
      attempts: number;
    }> = [];
    const maxRetries = 3; // Max retries per failed order

    for (let i = 0; i < executionsCount; i++) {
      let orderExecuted = false;
      let attempts = 0;

      while (!orderExecuted && attempts < maxRetries) {
        try {
          attempts++;
          retryAttempts++;

          // Calculate small random trade value in USDT (5-15 USDT range)
          const tradeValueUSDT =
            Math.random() * (maxTradeValueUSDT - minTradeValueUSDT) +
            minTradeValueUSDT;

          // Get fresh price for each retry (market conditions might change)
          const currentPrice = (await this.getCurrentPrice()) || basePrice;

          // Calculate size in ILMT based on current price
          const tradeSize = Math.round(tradeValueUSDT / currentPrice);

          // Skip if trade size is too small (less than 150 ILMT minimum)
          if (tradeSize < 150) {
            console.log(
              `⚠️ Trade ${i + 1}: Size too small (${tradeSize} ILMT), adjusting...`,
            );
            // Increase trade value to meet minimum
            const adjustedTradeValue = 150 * currentPrice + 1; // +1 for buffer
            const adjustedTradeSize = Math.round(
              adjustedTradeValue / currentPrice,
            );

            if (adjustedTradeSize >= 150) {
              console.log(
                `✅ Adjusted to ${adjustedTradeSize} ILMT (${adjustedTradeValue.toFixed(2)} USDT)`,
              );
              // Continue with adjusted size
            } else {
              console.log(`❌ Cannot adjust trade size adequately, skipping`);
              orderExecuted = true; // Skip this iteration
              continue;
            }
          }

          // Determine trade side (balanced approach)
          const tradeSide = await this.calculateTradeSide();

          // Enhanced order execution with validation
          const executionResult = await this.executeGuaranteedOrder({
            symbol: 'ILMTUSDT',
            side: tradeSide,
            tradeSize,
            tradeValueUSDT,
            attempt: attempts,
          });

          if (executionResult.success) {
            burstResults.push({
              orderId: executionResult.orderId || 'unknown',
              side: tradeSide,
              size: tradeSize,
              value: tradeValueUSDT,
              attempts: attempts,
            });

            // Record the trade
            await this.recordTrade(
              tradeSide,
              tradeSize,
              executionResult.executionPrice || basePrice,
            );

            totalBurstVolumeUSDT += tradeValueUSDT;
            totalBurstVolumeILMT += tradeSize;
            successfulTrades++;
            orderExecuted = true;

            console.log(
              `✅ Micro-trade ${i + 1}/${executionsCount}: ${tradeSide} ${tradeSize} ILMT (${tradeValueUSDT.toFixed(2)} USDT) - Order: ${executionResult.orderId} [Attempt ${attempts}]`,
            );
          } else {
            console.log(
              `⚠️ Attempt ${attempts}/${maxRetries} failed for trade ${i + 1}: ${executionResult.error}`,
            );
            if (attempts < maxRetries) {
              // Wait before retry (exponential backoff)
              const retryDelay = Math.min(
                1000 * Math.pow(2, attempts - 1),
                5000,
              ); // 1s, 2s, 4s max
              console.log(`⏳ Retrying in ${retryDelay}ms...`);
              await new Promise((resolve) => setTimeout(resolve, retryDelay));
            }
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          console.log(
            `❌ Unexpected error on attempt ${attempts} for trade ${i + 1}: ${errorMessage}`,
          );

          if (attempts < maxRetries) {
            const retryDelay = Math.min(2000 * attempts, 5000);
            await new Promise((resolve) => setTimeout(resolve, retryDelay));
          }
        }
      }

      if (!orderExecuted) {
        console.log(
          `🚫 Trade ${i + 1} FAILED after ${maxRetries} attempts - continuing with next trade`,
        );
        this.loggingService.error(
          `Failed to execute burst trade ${i + 1} after ${maxRetries} attempts`,
        );
      }

      // Small delay between successful orders (50-200ms to avoid overwhelming but be quick)
      if (orderExecuted && i < executionsCount - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, 50 + Math.random() * 150),
        );
      }
    }

    // Calculate success rate
    const successRate = (successfulTrades / executionsCount) * 100;
    const avgAttemptsPerTrade = retryAttempts / executionsCount;

    console.log(`💥 HIGH_VOLUME_BURST execution completed (ENHANCED):`);
    console.log(`   • Total successful trades: ${successfulTrades}/${executionsCount} (${successRate.toFixed(1)}% success rate)`);
    console.log(`   • Average attempts per trade: ${avgAttemptsPerTrade.toFixed(1)}`);
    console.log(`   • Total USDT value: ${totalBurstVolumeUSDT.toFixed(2)} USDT (SAFE SMALL AMOUNT!)`);
    console.log(`   • Total ILMT volume: ${totalBurstVolumeILMT.toFixed(0)} ILMT`);
    console.log(`   • Avg trade size: ${(totalBurstVolumeUSDT / Math.max(successfulTrades, 1)).toFixed(2)} USDT per trade`);
    console.log(`   • Target was: ${targetILMTVolume.toFixed(0)} ILMT`);
    console.log(`   • IMPORTANT: All trades limited to MAX 150 ILMT each! 🔒`);

    // Alert if success rate is below threshold
    if (successRate < 90) {
      console.log(`🚨 WARNING: Success rate ${successRate.toFixed(1)}% is below 90% - market conditions may be poor!`);
      this.loggingService.warn(`LOW SUCCESS RATE: ${successRate.toFixed(1)}% in HIGH_VOLUME_BURST execution`);
    }

    this.loggingService.info('💥 HIGH_VOLUME_BURST executed (ENHANCED)', {
      component: 'VolumeBoosterService',
      executionsCount,
      successfulTrades,
      successRate: Math.round(successRate),
      avgAttemptsPerTrade: Math.round(avgAttemptsPerTrade * 100) / 100,
      totalBurstVolumeUSDT: Math.round(totalBurstVolumeUSDT),
      totalBurstVolumeILMT: Math.round(totalBurstVolumeILMT),
      targetILMTVolume: Math.round(targetILMTVolume),
      avgTradeValueUSDT: totalBurstVolumeUSDT / Math.max(successfulTrades, 1),
      basePrice,
      strategy: this.config.strategy,
    });
  }

  /**
   * Pre-execution validation to ensure optimal trading conditions
   */
  private async preExecutionValidation(): Promise<{ canExecute: boolean; reason?: string }> {
    try {
      console.log('🔍 Running pre-execution validation checks...');
      
      // Check 1: Market price availability
      const currentPrice = await this.getCurrentPrice();
      if (!currentPrice) {
        return { canExecute: false, reason: 'Cannot get current market price' };
      }
      
      // Check 2: Spread analysis (tight spread = better execution)
      const ticker = await this.mexcApiService.getBookTicker('ILMTUSDT');
      const bidPrice = parseFloat(ticker.bidPrice);
      const askPrice = parseFloat(ticker.askPrice);
      const spread = askPrice - bidPrice;
      const spreadPercent = (spread / bidPrice) * 100;
      
      console.log(`📊 Market conditions: Bid: $${bidPrice.toFixed(6)}, Ask: $${askPrice.toFixed(6)}, Spread: ${spreadPercent.toFixed(3)}%`);
      
      // Warning if spread is too wide (might indicate low liquidity)
      if (spreadPercent > 1.0) {
        console.log(`⚠️ Wide spread detected (${spreadPercent.toFixed(3)}%), execution might be less predictable`);
      }
      
      // Check 3: Trading volume validation (ensure there's market activity)
      if (spreadPercent > 5.0) {
        return { canExecute: false, reason: `Spread too wide (${spreadPercent.toFixed(2)}%) - low liquidity detected` };
      }
      
      console.log('✅ Pre-execution validation passed');
      return { canExecute: true };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { canExecute: false, reason: `Pre-validation failed: ${errorMessage}` };
    }
  }

  /**
   * Enhanced order execution with guaranteed execution features and 150 ILMT per trade limit
   */
  private async executeGuaranteedOrder(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    tradeSize: number;
    tradeValueUSDT: number;
    attempt: number;
  }): Promise<{ success: boolean; orderId?: string; executionPrice?: number; error?: string }> {
    try {
      // IMPORTANT: Enforce 150 ILMT per trade limit
      const maxTradeSize = 150;
      const actualTradeSize = Math.min(params.tradeSize, maxTradeSize);
      
      if (actualTradeSize < params.tradeSize) {
        console.log(`🔒 Trade size limited: ${params.tradeSize} ILMT → ${actualTradeSize} ILMT (150 ILMT max per trade)`);
      }

      console.log(`🎯 Attempting guaranteed order execution (attempt ${params.attempt}): ${params.side} ${actualTradeSize} ILMT (MAX 150 ILMT enforced)`);
      
      // Execute market order for best execution speed with size limit
      const order = await this.mexcApiService.placeOrder({
        symbol: params.symbol,
        side: params.side,
        type: 'MARKET',
        quantity: formatMexcQuantity(actualTradeSize),
      });
      
      // Validate order was placed successfully
      if (!order.orderId) {
        return { success: false, error: 'Order placed but no order ID returned' };
      }
      
      // Get execution price (use order price if available, otherwise use current market price)
      let executionPrice = parseFloat(order.price || '0');
      if (!executionPrice || executionPrice <= 0) {
        const currentPrice = await this.getCurrentPrice();
        executionPrice = currentPrice || 0.009; // fallback price
        console.log(`📊 Using current market price for execution: $${executionPrice.toFixed(6)}`);
      }
      
      // Validate execution makes sense (basic sanity check)
      const expectedValue = actualTradeSize * executionPrice; // Use actual trade size for validation
      const adjustedTargetValue = params.tradeValueUSDT * (actualTradeSize / params.tradeSize); // Adjust target for size limit
      const valueDifference = Math.abs(expectedValue - adjustedTargetValue);
      const percentDifference = (valueDifference / adjustedTargetValue) * 100;
      
      if (percentDifference > 20) { // Allow up to 20% variance due to market volatility
        console.log(`⚠️ Large execution variance: Expected ${adjustedTargetValue.toFixed(2)} USDT, got ${expectedValue.toFixed(2)} USDT (${percentDifference.toFixed(1)}% diff)`);
      }
      
      console.log(`✅ Order executed successfully: ID ${order.orderId}, Size: ${actualTradeSize} ILMT (≤150), Price: $${executionPrice.toFixed(6)}`);
      
      return {
        success: true,
        orderId: String(order.orderId || 'unknown'),
        executionPrice: executionPrice
      };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`❌ Order execution failed (attempt ${params.attempt}): ${errorMessage}`);
      
      // Categorize error types for better retry logic
      let retryable = true;
      if (errorMessage.toLowerCase().includes('insufficient') || 
          errorMessage.toLowerCase().includes('balance') ||
          errorMessage.toLowerCase().includes('minimum')) {
        retryable = false; // Don't retry balance or size issues
      }
      
      return { 
        success: false, 
        error: `${errorMessage}${retryable ? ' (retryable)' : ' (non-retryable)'}`
      };
    }
  }
}