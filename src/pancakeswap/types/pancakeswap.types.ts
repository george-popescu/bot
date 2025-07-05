// PancakeSwap V2 Types and Interfaces

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
  amountIn: string;
  amountOutMin: string;
}

export interface SwapResult {
  transactionHash: string;
  blockNumber: number;
  gasUsed: string;
  effectiveGasPrice: string;
  amountIn: string;
  amountOut: string;
  path: string[];
  timestamp: Date;
  success: boolean;
  error?: string;
}

export interface GasEstimate {
  gasLimit: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  estimatedCost: string;
  estimatedCostUsd?: string;
}

export interface TokenBalance {
  token: TokenInfo;
  balance: string;
  balanceFormatted: string;
  balanceUsd?: string;
}

export interface PairReserves {
  token0: string;
  token1: string;
  reserve0: string;
  reserve1: string;
  blockTimestampLast: number;
}

export interface LiquidityPool {
  address: string;
  token0: TokenInfo;
  token1: TokenInfo;
  reserves: PairReserves;
  totalSupply: string;
}

// Transaction Types
export interface SwapTransaction {
  to: string;
  data: string;
  value: string;
  gasLimit: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

export interface ApprovalTransaction {
  token: string;
  spender: string;
  amount: string;
  transactionHash?: string;
  gasUsed?: string;
}

// Price calculation types
export interface PriceQuote {
  tokenIn: TokenInfo;
  tokenOut: TokenInfo;
  amountIn: string;
  amountOut: string;
  priceImpact: string;
  minimumAmountOut: string;
  route: string[];
  gasEstimate: GasEstimate;
}

export interface PriceComparison {
  directPrice: string;
  routedPrice?: string;
  bestRoute: string[];
  priceImpact: string;
  slippage: string;
}

// Events
export interface SwapEvent {
  transactionHash: string;
  blockNumber: number;
  logIndex: number;
  sender: string;
  to: string;
  amount0In: string;
  amount1In: string;
  amount0Out: string;
  amount1Out: string;
  pairAddress: string;
}

export interface SyncEvent {
  transactionHash: string;
  blockNumber: number;
  reserve0: string;
  reserve1: string;
  pairAddress: string;
}

// Configuration types
export interface PancakeSwapConfig {
  rpcUrl: string;
  chainId: number;
  routerAddress: string;
  factoryAddress: string;
  walletPrivateKey: string;
  maxGasPrice: string;
  slippageTolerance: number;
  deadlineMinutes: number;
}

export interface BlockchainServiceConfig {
  provider: {
    url: string;
    chainId: number;
    timeout: number;
    retries: number;
  };
  wallet: {
    privateKey: string;
  };
  contracts: {
    router: string;
    factory: string;
  };
  gas: {
    maxGasPrice: string;
    gasLimitMultiplier: number;
    priorityFee?: string;
  };
  safety: {
    maxSlippage: number;
    deadline: number;
    maxTradeSize: string;
  };
}

// Error types
export class PancakeSwapError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly transactionHash?: string,
    public readonly context?: any,
  ) {
    super(message);
    this.name = 'PancakeSwapError';
  }
}

export class InsufficientLiquidityError extends PancakeSwapError {
  constructor(tokenA: string, tokenB: string, context?: any) {
    super(
      `Insufficient liquidity for pair ${tokenA}/${tokenB}`,
      'INSUFFICIENT_LIQUIDITY',
      undefined,
      context,
    );
    this.name = 'InsufficientLiquidityError';
  }
}

export class SlippageExceededError extends PancakeSwapError {
  constructor(expected: string, actual: string, context?: any) {
    super(
      `Slippage exceeded: expected ${expected}, got ${actual}`,
      'SLIPPAGE_EXCEEDED',
      undefined,
      context,
    );
    this.name = 'SlippageExceededError';
  }
}

export class GasPriceTooHighError extends PancakeSwapError {
  constructor(gasPrice: string, maxGasPrice: string, context?: any) {
    super(
      `Gas price ${gasPrice} exceeds maximum ${maxGasPrice}`,
      'GAS_PRICE_TOO_HIGH',
      undefined,
      context,
    );
    this.name = 'GasPriceTooHighError';
  }
}

// Constants
export const PANCAKESWAP_CONTRACTS = {
  ROUTER_V2: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
  FACTORY_V2: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
  MULTICALL: '0x65F3A0C2B2F3Cdb2C1F4e75d69E4C71E2dE4DFe6',
  WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
} as const;

export const BSC_TOKENS = {
  WBNB: {
    symbol: 'WBNB',
    address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    decimals: 18,
    name: 'Wrapped BNB',
  },
  USDT: {
    symbol: 'USDT',
    address: '0x55d398326f99059fF775485246999027B3197955',
    decimals: 18,
    name: 'Tether USD',
  },
  BUSD: {
    symbol: 'BUSD',
    address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
    decimals: 18,
    name: 'Binance USD',
  },
  USDC: {
    symbol: 'USDC',
    address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    decimals: 18,
    name: 'USD Coin',
  },
} as const;

export const PANCAKE_SWAP_FEES = {
  LP_FEE: 0.0025, // 0.25%
  PROTOCOL_FEE: 0, // Currently 0%
  TOTAL_FEE: 0.0025, // 0.25% total
} as const;

export const GAS_ESTIMATES = {
  APPROVE: '45000',           // Reduced from 50k
  SWAP: '120000',            // Reduced from 200k to 120k
  ADD_LIQUIDITY: '250000',   // Reduced from 300k
  REMOVE_LIQUIDITY: '200000', // Reduced from 250k
} as const;

export const SLIPPAGE_PRESETS = {
  VERY_LOW: 0.001, // 0.1%
  LOW: 0.005, // 0.5%
  MEDIUM: 0.01, // 1%
  HIGH: 0.03, // 3%
  VERY_HIGH: 0.05, // 5%
} as const;

// Utility types
export type SwapDirection = 'EXACT_INPUT' | 'EXACT_OUTPUT';
export type TransactionStatus = 'PENDING' | 'CONFIRMED' | 'FAILED' | 'DROPPED';
export type PriceSource = 'RESERVES' | 'ORACLE' | 'AGGREGATOR';

// Route finding types
export interface RouteNode {
  token: TokenInfo;
  pair?: string;
  reserve0?: string;
  reserve1?: string;
}

export interface SwapRoute {
  path: TokenInfo[];
  pairs: string[];
  amountOut: string;
  priceImpact: string;
  gasEstimate: string;
  hops: number;
}

export interface RoutingResult {
  bestRoute: SwapRoute;
  alternativeRoutes: SwapRoute[];
  directRoute?: SwapRoute;
}

// AMM Math types
export interface AMMCalculation {
  amountOut: string;
  priceImpact: string;
  fee: string;
  slippage: string;
  minimumReceived: string;
}

export interface ReserveData {
  reserve0: string;
  reserve1: string;
  token0: string;
  token1: string;
  blockNumber: number;
  timestamp: number;
}
