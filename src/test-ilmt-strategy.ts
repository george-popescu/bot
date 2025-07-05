import { ILMTOptimizedStrategyService } from './arbitrage/services/ilmt-optimized-strategy.service';
import { ExchangePrice } from './arbitrage/types/arbitrage.types';

// Mock price data pentru test
const mockMexcPrice: ExchangePrice = {
  exchange: 'MEXC',
  symbol: 'ILMTUSDT',
  bidPrice: 0.009513,
  askPrice: 0.009574,
  volume: 1000000,
  timestamp: new Date(),
  source: 'REST',
};

const mockPancakePrice: ExchangePrice = {
  exchange: 'PANCAKESWAP',
  symbol: 'ILMTUSDT',
  bidPrice: 0.009646,
  askPrice: 0.009743,
  volume: 0,
  timestamp: new Date(),
  source: 'CONTRACT',
};

// Mock services
const mockConfigService = {
  get: (key: string, defaultValue?: any) => {
    const config: { [key: string]: any } = {
      'MONITORING_MODE': true,
      'ILMT_TOKEN_ADDRESS': '0x1234567890123456789012345678901234567890',
      'USDT_TOKEN_ADDRESS': '0x55d398326f99059fF775485246999027B3197955',
    };
    return config[key] || defaultValue;
  },
};

const mockEventEmitter = {
  emit: (event: string, data: any) => {
    console.log(`📡 Event emitted: ${event}`, data);
  },
};

const mockLoggingService = {
  info: (message: string, context?: any) => {
    console.log(`ℹ️ ${message}`, context ? JSON.stringify(context, null, 2) : '');
  },
  error: (message: string, error?: any) => {
    console.error(`❌ ${message}`, error);
  },
  warn: (message: string, context?: any) => {
    console.warn(`⚠️ ${message}`, context ? JSON.stringify(context, null, 2) : '');
  },
};

const mockMexcService = {
  getAccount: async () => ({
    balances: [
      { asset: 'ILMT', free: '5000', locked: '0' },
      { asset: 'USDT', free: '100', locked: '0' },
    ],
  }),
};

const mockPancakeService = {
  getTokenBalance: async (token: any) => {
    if (token.symbol === 'ILMT') return '3000';
    if (token.symbol === 'USDT') return '50';
    return '0';
  },
};

async function testILMTStrategy() {
  console.log('🧪 TESTING ILMT OPTIMIZED STRATEGY\n');

  const strategyService = new ILMTOptimizedStrategyService(
    mockConfigService as any,
    mockEventEmitter as any,
    mockLoggingService as any,
    mockMexcService as any,
    mockPancakeService as any,
  );

  try {
    // Test 1: Analizează strategia cu prețuri mock
    console.log('1. 📊 Analyzing strategy with mock prices...');
    const strategy = await strategyService.analyzeOptimalStrategy(
      mockMexcPrice,
      mockPancakePrice,
    );

    console.log('✅ Strategy analysis result:');
    console.log(`   Type: ${strategy.type}`);
    console.log(`   Exchange: ${strategy.exchange}`);
    console.log(`   Amount: ${strategy.amount}`);
    console.log(`   Expected Gain: $${strategy.expectedUsdtGain.toFixed(4)}`);
    console.log(`   Reasoning: ${strategy.reasoning}`);
    console.log(`   Confidence: ${strategy.confidence}`);

    // Test 2: Execută strategia (simulat)
    console.log('\n2. 🚀 Executing strategy...');
    const executed = await strategyService.executeStrategy(strategy);
    console.log(`✅ Strategy execution result: ${executed ? 'SUCCESS' : 'FAILED'}`);

    // Test 3: Obține portfolio
    console.log('\n3. 💰 Current portfolio:');
    const portfolio = strategyService.getCurrentPortfolio();
    if (portfolio) {
      console.log('   MEXC:');
      console.log(`     ILMT: ${portfolio.mexc.ilmt}`);
      console.log(`     USDT: ${portfolio.mexc.usdt}`);
      console.log('   PancakeSwap:');
      console.log(`     ILMT: ${portfolio.pancakeswap.ilmt}`);
      console.log(`     USDT: ${portfolio.pancakeswap.usdt}`);
      console.log('   Total:');
      console.log(`     ILMT: ${portfolio.total.ilmt}`);
      console.log(`     USDT: ${portfolio.total.usdt}`);
    }

    // Test 4: Istoricul prețurilor
    console.log('\n4. 📈 Price history:');
    const history = strategyService.getPriceHistory();
    console.log(`   History entries: ${history.length}`);
    if (history.length > 0) {
      const latest = history[history.length - 1];
      console.log(`   Latest: MEXC=$${latest.mexc.toFixed(6)}, PANCAKE=$${latest.pancakeswap.toFixed(6)}`);
    }

    console.log('\n🎉 All tests completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Rulează testul
testILMTStrategy().catch(console.error); 