// Common types and interfaces

export interface PriceData {
  price: number;
  timestamp: Date;
  source: 'MEXC' | 'DEX';
  symbol?: string;
  bid?: number;
  ask?: number;
}

export interface Balance {
  asset: string;
  available: number;
  locked: number;
  total: number;
}

export interface Trade {
  id: string;
  pair: string;
  direction: 'CEX_TO_DEX' | 'DEX_TO_CEX';
  profit: number;
  profitUsd: number;
  executedAt: Date;
  mexcOrderId?: string;
  bscTxHash?: string;
  mexcSide: 'BUY' | 'SELL';
  mexcQuantity: number;
  mexcPrice: number;
  dexAmountIn: number;
  dexAmountOut: number;
  gasUsed?: number;
  gasCostUsd?: number;
  executionTimeMs: number;
  status: 'SUCCESS' | 'PARTIAL_FAILURE' | 'TOTAL_FAILURE';
  errorMessage?: string;
}

export interface ArbitrageOpportunity {
  id: string;
  pair: string;
  mexcPrice: number;
  dexPrice: number;
  spread: number;
  spreadPercent: number;
  direction: 'CEX_TO_DEX' | 'DEX_TO_CEX';
  estimatedProfitUsd: number;
  tradeSize: number;
  executable: boolean;
  reason?: string;
  detectedAt: Date;
  fees: {
    mexcFee: number;
    dexFee: number;
    gasCost: number;
    totalFees: number;
  };
}

export interface BotStatus {
  enabled: boolean;
  running: boolean;
  uptime: number;
  lastTrade?: Date;
  totalTrades: number;
  totalProfit: number;
  todayProfit: number;
  errorCount: number;
  lastError?: string;
}

export interface HealthCheck {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: Date;
  components: {
    mexcApi: ComponentHealth;
    mexcWebSocket: ComponentHealth;
    bscRpc: ComponentHealth;
    wallet: ComponentHealth;
  };
  uptime: number;
  lastTrade?: Date;
}

export interface ComponentHealth {
  status: 'connected' | 'disconnected' | 'error' | 'degraded';
  message?: string;
  lastCheck: Date;
  responseTime?: number;
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface LogContext {
  tradeId?: string;
  pair?: string;
  operation?: string;
  component?: string;
  duration?: number;
  [key: string]: any;
}

export interface TradingConfig {
  enabled: boolean;
  minProfitThreshold: number;
  maxTradeSize: number;
  maxSlippage: number;
  cooldownMs: number;
  maxDailyVolume: number;
  maxTradesPerHour: number;
  maxGasPrice: number;
}

export interface RiskConfig {
  emergencyStopLossRatio: number;
  minBalanceThresholds: {
    usdt: number;
    ilmt: number;
    bnb: number;
  };
}

export interface TokenInfo {
  symbol: string;
  address: string;
  decimals: number;
  name?: string;
}

export interface SwapPath {
  tokenIn: TokenInfo;
  tokenOut: TokenInfo;
  path: string[];
}

// Error types
export class ArbitrageError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: any,
  ) {
    super(message);
    this.name = 'ArbitrageError';
  }
}

export class MexcApiError extends ArbitrageError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    context?: any,
  ) {
    super(message, 'MEXC_API_ERROR', context);
    this.name = 'MexcApiError';
  }
}

export class BlockchainError extends ArbitrageError {
  constructor(
    message: string,
    public readonly txHash?: string,
    context?: any,
  ) {
    super(message, 'BLOCKCHAIN_ERROR', context);
    this.name = 'BlockchainError';
  }
}

export class ConfigurationError extends ArbitrageError {
  constructor(message: string, context?: any) {
    super(message, 'CONFIGURATION_ERROR', context);
    this.name = 'ConfigurationError';
  }
}

// Events
export interface PriceUpdateEvent {
  type: 'PRICE_UPDATE';
  data: PriceData;
}

export interface OpportunityDetectedEvent {
  type: 'OPPORTUNITY_DETECTED';
  data: ArbitrageOpportunity;
}

export interface TradeExecutedEvent {
  type: 'TRADE_EXECUTED';
  data: Trade;
}

export interface ErrorEvent {
  type: 'ERROR';
  data: {
    error: Error;
    context: LogContext;
  };
}

export interface BalanceUpdateEvent {
  type: 'BALANCE_UPDATE';
  data: {
    platform: 'MEXC' | 'BSC';
    balances: Balance[];
  };
}

export type BotEvent =
  | PriceUpdateEvent
  | OpportunityDetectedEvent
  | TradeExecutedEvent
  | ErrorEvent
  | BalanceUpdateEvent;
