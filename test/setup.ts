import 'reflect-metadata';

// Global test setup
beforeAll(() => {
  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.MEXC_API_KEY = 'test_api_key';
  process.env.MEXC_SECRET_KEY = 'test_secret_key';
  process.env.BSC_RPC_URL = 'https://bsc-dataseed1.binance.org/';
  process.env.BSC_WALLET_PRIVATE_KEY = '0x' + '0'.repeat(64); // Dummy private key for tests
  process.env.PANCAKE_ROUTER_ADDRESS =
    '0x10ED43C718714eb63d5aA57B78B54704E256024E';
  process.env.ILMT_TOKEN_ADDRESS = '0x' + '1'.repeat(40); // Dummy ILMT address
  process.env.USDT_TOKEN_ADDRESS = '0x55d398326f99059fF775485246999027B3197955';
  process.env.BOT_ENABLED = 'false';
  process.env.MIN_PROFIT_THRESHOLD = '1.0';
  process.env.MAX_TRADE_SIZE = '100.0';
  process.env.MAX_SLIPPAGE = '0.5';
  process.env.LOG_LEVEL = 'error'; // Reduce log noise in tests
});

// Mock console methods to reduce test output noise
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Global test utilities
(global as any).testUtils = {
  createMockPrice: (price: number) => ({
    price,
    timestamp: new Date(),
    source: 'test',
  }),

  createMockTrade: (profit: number) => ({
    id: 'test-trade-123',
    pair: 'ILMTUSDT',
    direction: 'CEX_TO_DEX' as const,
    profit,
    executedAt: new Date(),
    mexcOrderId: 'mexc-123',
    bscTxHash: '0x' + '1'.repeat(64),
  }),

  createMockBalance: (asset: string, amount: number) => ({
    asset,
    available: amount,
    locked: 0,
    total: amount,
  }),
};

// Extend global types for test utilities
declare global {
  namespace NodeJS {
    interface Global {
      testUtils: {
        createMockPrice: (price: number) => any;
        createMockTrade: (profit: number) => any;
        createMockBalance: (asset: string, amount: number) => any;
      };
    }
  }
}
