import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';
import { EnvironmentVariables } from './validation.schema';

@Injectable()
export class ConfigService {
  constructor(
    private readonly configService: NestConfigService<
      EnvironmentVariables,
      true
    >,
  ) {}

  // Environment
  get nodeEnv(): string {
    return this.configService.get('NODE_ENV');
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get isDevelopment(): boolean {
    return this.nodeEnv === 'development';
  }

  get isTest(): boolean {
    return this.nodeEnv === 'test';
  }

  // Bot Configuration
  get botEnabled(): boolean {
    return this.configService.get('BOT_ENABLED');
  }

  get monitoringMode(): boolean {
    return this.configService.get('MONITORING_MODE');
  }

  get logLevel(): string {
    return this.configService.get('LOG_LEVEL');
  }

  // MEXC Configuration
  get mexcApiKey(): string {
    return this.configService.get('MEXC_API_KEY');
  }

  get mexcSecretKey(): string {
    return this.configService.get('MEXC_SECRET_KEY');
  }

  get mexcBaseUrl(): string {
    return this.configService.get('MEXC_BASE_URL');
  }

  get mexcWsUrl(): string {
    return this.configService.get('MEXC_WS_URL');
  }

  // BSC Configuration
  get bscRpcUrl(): string {
    return this.configService.get('BSC_RPC_URL');
  }

  get bscWalletPrivateKey(): string {
    return this.configService.get('BSC_PRIVATE_KEY');
  }

  get bscChainId(): number {
    return this.configService.get('BSC_CHAIN_ID');
  }

  // Contract Addresses
  get pancakeRouterAddress(): string {
    return this.configService.get('PANCAKE_ROUTER_ADDRESS');
  }

  get ilmtTokenAddress(): string {
    return this.configService.get('ILMT_TOKEN_ADDRESS');
  }

  get usdtTokenAddress(): string {
    return this.configService.get('USDT_TOKEN_ADDRESS');
  }

  // Trading Configuration
  get tradingConfig() {
    return {
      minProfitThreshold: this.configService.get('MIN_PROFIT_THRESHOLD'),
      maxTradeSize: this.configService.get('MAX_TRADE_SIZE'),
      maxSlippage: this.configService.get('MAX_SLIPPAGE'),
      cooldownMs: this.configService.get('COOLDOWN_MS'),
      maxDailyVolume: this.configService.get('MAX_DAILY_VOLUME'),
      maxTradesPerHour: this.configService.get('MAX_TRADES_PER_HOUR'),
      maxGasPrice: this.configService.get('MAX_GAS_PRICE'),
    };
  }

  // Risk Management
  get riskConfig() {
    return {
      emergencyStopLossRatio: this.configService.get(
        'EMERGENCY_STOP_LOSS_RATIO',
      ),
      minBalanceThresholds: {
        usdt: this.configService.get('MIN_BALANCE_THRESHOLD_USDT'),
        ilmt: this.configService.get('MIN_BALANCE_THRESHOLD_ILMT'),
        bnb: this.configService.get('MIN_BALANCE_THRESHOLD_BNB'),
      },
    };
  }

  // Market Making Configuration
  get marketMakingConfig() {
    return {
      enabled: this.configService.get('MM_ENABLED'),
      exchange: this.configService.get('MM_EXCHANGE'),
      spread: this.configService.get('MM_SPREAD'),
      orderSize: this.configService.get('MM_ORDER_SIZE'),
      maxOrders: this.configService.get('MM_MAX_ORDERS'),
      refreshInterval: this.configService.get('MM_REFRESH_INTERVAL'),
      priceOffset: this.configService.get('MM_PRICE_OFFSET'),
      levels: this.configService.get('MM_LEVELS'),
      levelDistance: this.configService.get('MM_LEVEL_DISTANCE'),
      strategy: this.configService.get('MM_STRATEGY'),
      buyRatio: this.configService.get('MM_BUY_RATIO'),
      sellRatio: this.configService.get('MM_SELL_RATIO'),
      maxRebalanceDistance: this.configService.get('MM_MAX_REBALANCE_DISTANCE'),
    };
  }

  // Volume Booster Configuration
  get volumeBoosterConfig() {
    return {
      enabled: this.configService.get('VB_ENABLED'),
      monitoringMode: this.configService.get('VB_MONITORING_MODE'),
      targetVolumeDaily: this.configService.get('VB_TARGET_VOLUME_DAILY'),
      minTradeSize: this.configService.get('VB_MIN_TRADE_SIZE'),
      maxTradeSize: this.configService.get('VB_MAX_TRADE_SIZE'),
      cycleIntervalMin: this.configService.get('VB_CYCLE_INTERVAL_MIN'),
      cycleIntervalMax: this.configService.get('VB_CYCLE_INTERVAL_MAX'),
      priceDeviationLimit: this.configService.get('VB_PRICE_DEVIATION_LIMIT'),
      dailyFeeBudget: this.configService.get('VB_DAILY_FEE_BUDGET'),
      stealthMode: this.configService.get('VB_STEALTH_MODE'),
      icebergSize: this.configService.get('VB_ICEBERG_SIZE'),
      randomizeExecution: this.configService.get('VB_RANDOMIZE_EXECUTION'),
      maxConcurrentTrades: this.configService.get('VB_MAX_CONCURRENT_TRADES'),
      strategy: this.configService.get('VB_STRATEGY'),
      balanceWindow: this.configService.get('VB_BALANCE_WINDOW'),
      priceImpactLimit: this.configService.get('VB_PRICE_IMPACT_LIMIT'),
      useSpreadTrading: this.configService.get('VB_USE_SPREAD_TRADING'),
      maxConsecutiveSide: this.configService.get('VB_MAX_CONSECUTIVE_SIDE'),
      // HIGH_VOLUME_BURST specific configuration
      burstMinVolume: this.configService.get('VB_BURST_MIN_VOLUME'),
      burstMaxVolume: this.configService.get('VB_BURST_MAX_VOLUME'),
      burstMinExecutions: this.configService.get('VB_BURST_MIN_EXECUTIONS'),
      burstMaxExecutions: this.configService.get('VB_BURST_MAX_EXECUTIONS'),
      burstPriceSpreadUnits: this.configService.get('VB_BURST_PRICE_SPREAD_UNITS'),
    };
  }

  // Server Configuration
  get port(): number {
    return this.configService.get('PORT');
  }

  get apiRateLimit(): number {
    return this.configService.get('API_RATE_LIMIT');
  }

  // Helper methods for validation
  validateConfig(): void {
    // Additional runtime validations
    if (this.mexcApiKey.length < 10) {
      throw new Error('MEXC API Key appears to be invalid');
    }

    if (this.mexcSecretKey.length < 10) {
      throw new Error('MEXC Secret Key appears to be invalid');
    }

    if (!this.bscWalletPrivateKey.match(/^[a-fA-F0-9]{64}$/)) {
      throw new Error('BSC Private Key must be 64 character hex string');
    }
  }
}
