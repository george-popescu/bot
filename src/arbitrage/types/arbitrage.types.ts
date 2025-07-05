// Arbitrage Types and Interfaces

export interface ExchangePrice {
  exchange: 'MEXC' | 'PANCAKESWAP';
  symbol: string;
  bidPrice: number;
  askPrice: number;
  volume: number;
  timestamp: Date;
  source: 'REST' | 'WS' | 'CONTRACT';
}

export interface ArbitrageOpportunity {
  id: string;
  symbol: string;
  buyExchange: 'MEXC' | 'PANCAKESWAP';
  sellExchange: 'MEXC' | 'PANCAKESWAP';
  buyPrice: number;
  sellPrice: number;
  spread: number;
  spreadPercentage: number;
  estimatedProfit: number;
  estimatedProfitPercentage: number;
  maxTradeSize: number;
  timestamp: Date;
  expiresAt: Date;
  gasCost?: number;
  mexcFee: number;
  pancakeswapFee: number;
  totalFees: number;
  netProfit: number;
  netProfitPercentage: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface TradeParams {
  symbol: string;
  side: 'BUY' | 'SELL';
  amount: number;
  price?: number;
  slippage: number;
  maxGasPrice?: number;
}

export interface ArbitrageTrade {
  id: string;
  opportunityId: string;
  symbol: string;
  amount: number;
  status: 'PENDING' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  mexcTrade?: {
    side: 'BUY' | 'SELL';
    orderId?: number;
    price: number;
    amount: number;
    status: string;
    executedAt?: Date;
    fee: number;
  };
  pancakeswapTrade?: {
    side: 'BUY' | 'SELL';
    transactionHash?: string;
    price: number;
    amount: number;
    status: string;
    executedAt?: Date;
    gasUsed?: number;
    gasCost?: number;
    fee: number;
  };
  totalProfit: number;
  totalFees: number;
  netProfit: number;
  executionTime: number;
  createdAt: Date;
  completedAt?: Date;
  error?: string;
}

export interface ArbitrageMetrics {
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  totalVolume: number;
  totalProfit: number;
  totalFees: number;
  netProfit: number;
  averageProfit: number;
  winRate: number;
  averageExecutionTime: number;
  largestProfit: number;
  largestLoss: number;
  dailyStats: {
    date: string;
    trades: number;
    volume: number;
    profit: number;
  }[];
}

export interface RiskManagement {
  maxTradeSize: number;
  maxDailyVolume: number;
  maxTradesPerHour: number;
  minProfitThreshold: number;
  maxSlippage: number;
  emergencyStopLoss: number;
  balanceThresholds: {
    usdt: number;
    ilmt: number;
    bnb: number;
  };
  cooldownPeriod: number;
}

export interface ArbitrageConfig {
  enabled: boolean;
  symbol: string;
  minSpread: number;
  maxSpread: number;
  priceUpdateInterval: number;
  opportunityTimeout: number;
  executionTimeout: number;
  riskManagement: RiskManagement;
  exchanges: {
    mexc: {
      enabled: boolean;
      fees: {
        maker: number;
        taker: number;
      };
    };
    pancakeswap: {
      enabled: boolean;
      fees: {
        swap: number;
        gas: number;
      };
      slippage: number;
    };
  };
}

export interface PriceAlert {
  id: string;
  symbol: string;
  type: 'SPREAD_HIGH' | 'SPREAD_LOW' | 'PRICE_SPIKE' | 'VOLUME_SPIKE';
  threshold: number;
  currentValue: number;
  message: string;
  timestamp: Date;
  acknowledged: boolean;
}

export interface BalanceSnapshot {
  timestamp: Date;
  mexc: {
    usdt: number;
    ilmt: number;
  };
  pancakeswap: {
    usdt: number;
    ilmt: number;
    bnb: number;
  };
  total: {
    usdt: number;
    ilmt: number;
    bnb: number;
  };
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

export class InsufficientBalanceError extends ArbitrageError {
  constructor(
    exchange: string,
    asset: string,
    required: number,
    available: number,
  ) {
    super(
      `Insufficient ${asset} balance on ${exchange}: required ${required}, available ${available}`,
      'INSUFFICIENT_BALANCE',
      { exchange, asset, required, available },
    );
    this.name = 'InsufficientBalanceError';
  }
}

export class PriceStaleError extends ArbitrageError {
  constructor(exchange: string, age: number, maxAge: number) {
    super(
      `Price data from ${exchange} is stale: ${age}ms old (max ${maxAge}ms)`,
      'PRICE_STALE',
      { exchange, age, maxAge },
    );
    this.name = 'PriceStaleError';
  }
}

export class ExecutionTimeoutError extends ArbitrageError {
  constructor(tradeId: string, timeout: number) {
    super(
      `Trade execution timeout: ${tradeId} (${timeout}ms)`,
      'EXECUTION_TIMEOUT',
      { tradeId, timeout },
    );
    this.name = 'ExecutionTimeoutError';
  }
}

export class RiskLimitExceededError extends ArbitrageError {
  constructor(limit: string, current: number, max: number) {
    super(
      `Risk limit exceeded: ${limit} current ${current}, max ${max}`,
      'RISK_LIMIT_EXCEEDED',
      { limit, current, max },
    );
    this.name = 'RiskLimitExceededError';
  }
}

// Event types
export interface ArbitrageEvents {
  'opportunity.detected': ArbitrageOpportunity;
  'opportunity.expired': { id: string; reason: string };
  'trade.started': ArbitrageTrade;
  'trade.completed': ArbitrageTrade;
  'trade.failed': { trade: ArbitrageTrade; error: string };
  'price.updated': { exchange: string; price: ExchangePrice };
  'balance.updated': BalanceSnapshot;
  'alert.triggered': PriceAlert;
  'risk.exceeded': { type: string; value: number; limit: number };
  'system.status': { status: 'ACTIVE' | 'PAUSED' | 'STOPPED'; reason?: string };
}

// Utility types
export type ArbitrageDirection = 'MEXC_TO_PANCAKE' | 'PANCAKE_TO_MEXC';
export type OpportunityStatus =
  | 'ACTIVE'
  | 'EXPIRED'
  | 'EXECUTING'
  | 'COMPLETED';
export type AlertSeverity = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

// Constants
export const ARBITRAGE_CONSTANTS = {
  DEFAULT_OPPORTUNITY_TIMEOUT: 30000, // 30 seconds
  DEFAULT_EXECUTION_TIMEOUT: 120000, // 2 minutes
  MIN_PROFIT_THRESHOLD: 0.5, // 0.5%
  MAX_SLIPPAGE: 3.0, // 3%
  PRICE_STALENESS_THRESHOLD: 10000, // 10 seconds
  BALANCE_CHECK_INTERVAL: 30000, // 30 seconds
  METRICS_UPDATE_INTERVAL: 60000, // 1 minute
} as const;

export const EXCHANGE_FEES = {
  MEXC: {
    MAKER: 0.002, // 0.2%
    TAKER: 0.002, // 0.2%
  },
  PANCAKESWAP: {
    SWAP: 0.0025, // 0.25%
    GAS_ESTIMATE: 0.005, // 0.5% of trade value as gas cost estimate
  },
} as const;
