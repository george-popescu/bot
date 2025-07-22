import * as Joi from 'joi';

export const validationSchema = Joi.object({
  // Environment
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  // Bot Configuration
  BOT_ENABLED: Joi.boolean().default(false),
  MONITORING_MODE: Joi.boolean()
    .default(true)
    .description('Run in monitoring mode (no real trades)'),
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'debug')
    .default('info'),

  // MEXC API
  MEXC_API_KEY: Joi.string().required().description('MEXC API Key'),
  MEXC_SECRET_KEY: Joi.string().required().description('MEXC Secret Key'),
  MEXC_BASE_URL: Joi.string().uri().default('https://api.mexc.com/api/v3'),
  MEXC_WS_URL: Joi.string().uri().default('wss://wbs-api.mexc.com/ws'),

  // BSC Configuration
  BSC_RPC_URL: Joi.string().uri().required().description('BSC RPC URL'),
  BSC_PRIVATE_KEY: Joi.string()
    .pattern(/^[a-fA-F0-9]{64}$/)
    .required()
    .description('BSC Wallet Private Key (64 chars hex)'),
  BSC_CHAIN_ID: Joi.number().valid(56, 97).default(56),
  BSC_RPC_TIMEOUT: Joi.number().min(10000).max(60000).default(30000),
  BSC_RPC_RETRIES: Joi.number().min(1).max(10).default(3),
  BSC_GAS_LIMIT_MULTIPLIER: Joi.number().min(1.0).max(2.0).default(1.1),
  BSC_PRIORITY_FEE: Joi.string()
    .pattern(/^\d+(\.\d+)?$/)
    .optional(),
  BSC_MAX_SLIPPAGE: Joi.number().min(0.001).max(0.1).default(0.03),
  BSC_DEADLINE_MINUTES: Joi.number().min(5).max(60).default(20),
  BSC_MAX_TRADE_SIZE: Joi.string()
    .pattern(/^\d+(\.\d+)?$/)
    .default('1000'),
  BSC_MAX_GAS_PRICE: Joi.string()
    .pattern(/^\d+(\.\d+)?$/)
    .default('10'),

  // Contract Addresses (40 chars hex with 0x prefix)
  PANCAKE_ROUTER_ADDRESS: Joi.string()
    .pattern(/^0x[a-fA-F0-9]{40}$/)
    .default('0x10ED43C718714eb63d5aA57B78B54704E256024E'),
  ILMT_TOKEN_ADDRESS: Joi.string()
    .pattern(/^0x[a-fA-F0-9]{40}$/)
    .required()
    .description('ILMT Token Contract Address'),
  USDT_TOKEN_ADDRESS: Joi.string()
    .pattern(/^0x[a-fA-F0-9]{40}$/)
    .default('0x55d398326f99059fF775485246999027B3197955'),

  // Trading Configuration
  MIN_PROFIT_THRESHOLD: Joi.number().min(0.1).max(100).default(0.5),
  MAX_TRADE_SIZE: Joi.number().min(1).max(5000).default(10.0),
  MAX_SLIPPAGE: Joi.number().min(0.1).max(5.0).default(1.0),
  COOLDOWN_MS: Joi.number().min(1000).max(60000).default(5000),
  MAX_DAILY_VOLUME: Joi.number().min(10).max(20000).default(50.0),
  MAX_TRADES_PER_HOUR: Joi.number().min(1).max(20).default(10),
  MAX_GAS_PRICE: Joi.number().min(1).max(50).default(3),

  // Risk Management
  EMERGENCY_STOP_LOSS_RATIO: Joi.number().min(0.01).max(0.5).default(0.05),
  MIN_BALANCE_THRESHOLD_USDT: Joi.number().min(1).max(1000).default(5.0),
  MIN_BALANCE_THRESHOLD_ILMT: Joi.number().min(0.1).max(1000).default(0.5),
  MIN_BALANCE_THRESHOLD_BNB: Joi.number().min(0.001).max(10).default(0.005),

  // Market Making Configuration
  MM_ENABLED: Joi.boolean().default(false),
  MM_EXCHANGE: Joi.string()
    .valid('MEXC', 'PANCAKESWAP', 'BOTH')
    .default('MEXC'),
  MM_SPREAD: Joi.number().min(0.1).max(5.0).default(0.5),
  MM_ORDER_SIZE: Joi.number().min(1).max(1000).default(10),
  MM_MAX_ORDERS: Joi.number().min(1).max(50).default(8),
  MM_REFRESH_INTERVAL: Joi.number().min(10).max(300).default(30),
  MM_PRICE_OFFSET: Joi.number().min(0.01).max(1.0).default(0.1),
  MM_LEVELS: Joi.number().min(1).max(20).default(8),
  MM_LEVEL_DISTANCE: Joi.number().min(0.1).max(5.0).default(0.5),
  MM_STRATEGY: Joi.string()
    .valid('BALANCED', 'BUY_ONLY', 'SELL_ONLY', 'ACCUMULATE', 'DISTRIBUTE')
    .default('BALANCED'),
  MM_BUY_RATIO: Joi.number().min(0.1).max(1.0).default(1.0),
  MM_SELL_RATIO: Joi.number().min(0.1).max(1.0).default(1.0),
  MM_MAX_REBALANCE_DISTANCE: Joi.number().min(1.0).max(20.0).default(5.0),

  // Volume Booster Configuration
  VB_ENABLED: Joi.boolean().default(false),
  VB_MONITORING_MODE: Joi.boolean().default(true),
  VB_TARGET_VOLUME_DAILY: Joi.number().min(100).max(50000).default(1000),
  VB_MIN_TRADE_SIZE: Joi.number().min(150).max(1000).default(150),
  VB_MAX_TRADE_SIZE: Joi.number().min(150).max(5000).default(300),
  VB_CYCLE_INTERVAL_MIN: Joi.number().min(1).max(3600).default(60),
  VB_CYCLE_INTERVAL_MAX: Joi.number().min(10).max(3600).default(300),
  VB_PRICE_DEVIATION_LIMIT: Joi.number().min(0.1).max(2.0).default(0.2),
  VB_DAILY_FEE_BUDGET: Joi.number().min(10).max(500).default(50),
  VB_STEALTH_MODE: Joi.boolean().default(true),
  VB_ICEBERG_SIZE: Joi.number().min(150).max(1000).default(200),
  VB_RANDOMIZE_EXECUTION: Joi.boolean().default(true),
  VB_MAX_CONCURRENT_TRADES: Joi.number().min(1).max(10).default(3),
  VB_STRATEGY: Joi.string()
    .valid(
      'RANDOM',
      'BALANCED',
      'SMART_SPREAD',
      'BUY_HEAVY',
      'SELL_HEAVY',
      'ALTERNATING',
      'HIGH_VOLUME_BURST',
    )
    .default('BALANCED'),
  VB_BALANCE_WINDOW: Joi.number().min(5).max(50).default(20),
  VB_PRICE_IMPACT_LIMIT: Joi.number().min(0.1).max(2.0).default(0.5),
  VB_USE_SPREAD_TRADING: Joi.boolean().default(true),
  VB_MAX_CONSECUTIVE_SIDE: Joi.number().min(1).max(10).default(3),

  // HIGH_VOLUME_BURST specific configuration
  VB_BURST_MIN_VOLUME: Joi.number().min(100).max(100000).default(7000), // ILMT cumulative target
  VB_BURST_MAX_VOLUME: Joi.number().min(1000).max(100000).default(30000), // ILMT cumulative target
  VB_BURST_MIN_EXECUTIONS: Joi.number().min(10).max(500).default(100), // Many small trades
  VB_BURST_MAX_EXECUTIONS: Joi.number().min(50).max(500).default(300), // Many small trades
  VB_BURST_PRICE_SPREAD_UNITS: Joi.number().min(0.000001).max(0.001).default(0.000020),

  // Server Configuration
  PORT: Joi.number().port().default(3000),
  API_RATE_LIMIT: Joi.number().min(10).max(1000).default(100),
});

export interface EnvironmentVariables {
  NODE_ENV: 'development' | 'production' | 'test';
  BOT_ENABLED: boolean;
  MONITORING_MODE: boolean;
  LOG_LEVEL: 'error' | 'warn' | 'info' | 'debug';

  MEXC_API_KEY: string;
  MEXC_SECRET_KEY: string;
  MEXC_BASE_URL: string;
  MEXC_WS_URL: string;

  BSC_RPC_URL: string;
  BSC_PRIVATE_KEY: string;
  BSC_CHAIN_ID: number;
  BSC_RPC_TIMEOUT: number;
  BSC_RPC_RETRIES: number;
  BSC_GAS_LIMIT_MULTIPLIER: number;
  BSC_PRIORITY_FEE?: string;
  BSC_MAX_SLIPPAGE: number;
  BSC_DEADLINE_MINUTES: number;
  BSC_MAX_TRADE_SIZE: string;
  BSC_MAX_GAS_PRICE: string;

  PANCAKE_ROUTER_ADDRESS: string;
  ILMT_TOKEN_ADDRESS: string;
  USDT_TOKEN_ADDRESS: string;

  MIN_PROFIT_THRESHOLD: number;
  MAX_TRADE_SIZE: number;
  MAX_SLIPPAGE: number;
  COOLDOWN_MS: number;
  MAX_DAILY_VOLUME: number;
  MAX_TRADES_PER_HOUR: number;
  MAX_GAS_PRICE: number;

  EMERGENCY_STOP_LOSS_RATIO: number;
  MIN_BALANCE_THRESHOLD_USDT: number;
  MIN_BALANCE_THRESHOLD_ILMT: number;
  MIN_BALANCE_THRESHOLD_BNB: number;

  MM_ENABLED: boolean;
  MM_EXCHANGE: 'MEXC' | 'PANCAKESWAP' | 'BOTH';
  MM_SPREAD: number;
  MM_ORDER_SIZE: number;
  MM_MAX_ORDERS: number;
  MM_REFRESH_INTERVAL: number;
  MM_PRICE_OFFSET: number;
  MM_LEVELS: number;
  MM_LEVEL_DISTANCE: number;
  MM_STRATEGY:
    | 'BALANCED'
    | 'BUY_ONLY'
    | 'SELL_ONLY'
    | 'ACCUMULATE'
    | 'DISTRIBUTE';
  MM_BUY_RATIO: number;
  MM_SELL_RATIO: number;
  MM_MAX_REBALANCE_DISTANCE: number;

  VB_ENABLED: boolean;
  VB_MONITORING_MODE: boolean;
  VB_TARGET_VOLUME_DAILY: number;
  VB_MIN_TRADE_SIZE: number;
  VB_MAX_TRADE_SIZE: number;
  VB_CYCLE_INTERVAL_MIN: number;
  VB_CYCLE_INTERVAL_MAX: number;
  VB_PRICE_DEVIATION_LIMIT: number;
  VB_DAILY_FEE_BUDGET: number;
  VB_STEALTH_MODE: boolean;
  VB_ICEBERG_SIZE: number;
  VB_RANDOMIZE_EXECUTION: boolean;
  VB_MAX_CONCURRENT_TRADES: number;
  VB_STRATEGY: 'RANDOM' | 'BALANCED' | 'SMART_SPREAD' | 'BUY_HEAVY' | 'SELL_HEAVY' | 'ALTERNATING' | 'HIGH_VOLUME_BURST';
  VB_BALANCE_WINDOW: number;
  VB_PRICE_IMPACT_LIMIT: number;
  VB_USE_SPREAD_TRADING: boolean;
  VB_MAX_CONSECUTIVE_SIDE: number;

  // HIGH_VOLUME_BURST specific configuration
  VB_BURST_MIN_VOLUME: number;
  VB_BURST_MAX_VOLUME: number;
  VB_BURST_MIN_EXECUTIONS: number;
  VB_BURST_MAX_EXECUTIONS: number;
  VB_BURST_PRICE_SPREAD_UNITS: number;

  PORT: number;
  API_RATE_LIMIT: number;
}
