import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LoggingService } from '../../logging/logging.service';
import { MexcApiService } from '../../mexc/services/mexc-api.service';
import { PancakeSwapService } from '../../pancakeswap/services/pancakeswap.service';
import { PriceCalculatorService } from './price-calculator.service';
import { ARBITRAGE_CONSTANTS } from '../types/arbitrage.types';

describe('PriceCalculatorService', () => {
  let service: PriceCalculatorService;
  let configService: jest.Mocked<ConfigService>;
  let eventEmitter: jest.Mocked<EventEmitter2>;
  let loggingService: jest.Mocked<LoggingService>;
  let mexcApiService: jest.Mocked<MexcApiService>;
  let pancakeSwapService: jest.Mocked<PancakeSwapService>;

  const mockConfig = {
    BOT_ENABLED: true,
    MIN_PROFIT_THRESHOLD: 1.0,
    MAX_TRADE_SIZE: 500,
    MAX_DAILY_VOLUME: 5000,
    MAX_TRADES_PER_HOUR: 20,
    MAX_SLIPPAGE: 0.5,
    EMERGENCY_STOP_LOSS_RATIO: 0.05,
    MIN_BALANCE_THRESHOLD_USDT: 10,
    MIN_BALANCE_THRESHOLD_ILMT: 1,
    MIN_BALANCE_THRESHOLD_BNB: 0.01,
    COOLDOWN_MS: 5000,
    ILMT_TOKEN_ADDRESS: '0x1234567890123456789012345678901234567890',
  };

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn((key: string) => mockConfig[key as keyof typeof mockConfig]),
    };

    const mockEventEmitter = {
      emit: jest.fn(),
    };

    const mockLoggingService = {
      info: jest.fn(),
    };

    const mockMexcApiService = {
      getTicker: jest.fn(),
      getBookTicker: jest.fn(),
    };

    const mockPancakeSwapService = {
      getQuote: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriceCalculatorService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
        {
          provide: LoggingService,
          useValue: mockLoggingService,
        },
        {
          provide: MexcApiService,
          useValue: mockMexcApiService,
        },
        {
          provide: PancakeSwapService,
          useValue: mockPancakeSwapService,
        },
      ],
    }).compile();

    service = module.get<PriceCalculatorService>(PriceCalculatorService);
    configService = module.get(ConfigService);
    eventEmitter = module.get(EventEmitter2);
    loggingService = module.get(LoggingService);
    mexcApiService = module.get(MexcApiService);
    pancakeSwapService = module.get(PancakeSwapService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Configuration', () => {
    it('should initialize with default config', () => {
      const config = service.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.symbol).toBe('ILMTUSDT');
      expect(config.minSpread).toBe(1.0);
      expect(config.riskManagement.maxTradeSize).toBe(500);
      expect(config.exchanges.mexc.enabled).toBe(true);
      expect(config.exchanges.pancakeswap.enabled).toBe(true);
    });

    it('should allow config updates', () => {
      const updates = {
        minSpread: 2.0,
        maxSpread: 40.0,
      };

      service.updateConfig(updates);
      const config = service.getConfig();

      expect(config.minSpread).toBe(2.0);
      expect(config.maxSpread).toBe(40.0);
      expect(loggingService.info).toHaveBeenCalledWith(
        'Arbitrage config updated',
        expect.objectContaining({
          component: 'PriceCalculatorService',
          updates,
        }),
      );
    });
  });

  describe('Price Updates', () => {
    it('should update MEXC price successfully', async () => {
      const mockTicker = {
        symbol: 'ILMTUSDT',
        priceChange: '0.001',
        priceChangePercent: '2.0',
        weightedAvgPrice: '0.05',
        prevClosePrice: '0.049',
        lastPrice: '0.05',
        lastQty: '100',
        bidPrice: '0.049',
        bidQty: '1000',
        askPrice: '0.051',
        askQty: '2000',
        openPrice: '0.049',
        highPrice: '0.052',
        lowPrice: '0.048',
        volume: '1000000',
        quoteVolume: '50000',
        openTime: Date.now() - 86400000,
        closeTime: Date.now(),
        count: 1000,
      };

      const mockBookTicker = {
        bidPrice: '0.049',
        askPrice: '0.051',
        bidQty: '1000',
        askQty: '2000',
      };

      mexcApiService.getTicker.mockResolvedValue(mockTicker);
      mexcApiService.getBookTicker.mockResolvedValue(mockBookTicker);

      await service.updateMexcPrice();

      expect(mexcApiService.getTicker).toHaveBeenCalledWith('ILMTUSDT');
      expect(mexcApiService.getBookTicker).toHaveBeenCalledWith('ILMTUSDT');

      expect(eventEmitter.emit).toHaveBeenCalledWith('price.updated', {
        exchange: 'MEXC',
        price: expect.objectContaining({
          exchange: 'MEXC',
          symbol: 'ILMTUSDT',
          bidPrice: 0.049,
          askPrice: 0.051,
          volume: 1000000,
          source: 'REST',
        }),
      });

      expect(loggingService.info).toHaveBeenCalledWith(
        'MEXC price updated',
        expect.objectContaining({
          component: 'PriceCalculatorService',
          symbol: 'ILMTUSDT',
          bid: 0.049,
          ask: 0.051,
          volume: 1000000,
        }),
      );
    });

    it('should handle MEXC price update errors', async () => {
      mexcApiService.getTicker.mockRejectedValue(new Error('API Error'));

      await service.updateMexcPrice();

      expect(loggingService.info).toHaveBeenCalledWith(
        'Failed to update MEXC price',
        expect.objectContaining({
          component: 'PriceCalculatorService',
          error: 'API Error',
          symbol: 'ILMTUSDT',
        }),
      );
    });

    it('should update PancakeSwap price successfully', async () => {
      const mockQuote = {
        tokenIn: {
          symbol: 'USDT',
          address: '0x55d398326f99059fF775485246999027B3197955',
          decimals: 18,
        },
        tokenOut: {
          symbol: 'ILMT',
          address: '0x1234567890123456789012345678901234567890',
          decimals: 18,
        },
        amountIn: '1',
        amountOut: '20.0', // 1 USDT = 20 ILMT
        priceImpact: '0.5',
        minimumAmountOut: '19.9',
        route: [
          '0x55d398326f99059fF775485246999027B3197955',
          '0x1234567890123456789012345678901234567890',
        ],
        gasEstimate: { gasLimit: '200000', estimatedCost: '0.01' },
      };

      pancakeSwapService.getQuote.mockResolvedValue(mockQuote);

      await service.updatePancakeSwapPrice();

      expect(pancakeSwapService.getQuote).toHaveBeenCalledWith(
        expect.objectContaining({ symbol: 'USDT' }),
        expect.objectContaining({ symbol: 'ILMT' }),
        '1',
        0.005, // 0.5% slippage converted to decimal
      );

      expect(eventEmitter.emit).toHaveBeenCalledWith('price.updated', {
        exchange: 'PANCAKESWAP',
        price: expect.objectContaining({
          exchange: 'PANCAKESWAP',
          symbol: 'ILMTUSDT',
          bidPrice: 19.9, // 20 - 0.1 (0.5% slippage)
          askPrice: 20.1, // 20 + 0.1 (0.5% slippage)
          volume: 0,
          source: 'CONTRACT',
        }),
      });
    });

    it('should handle PancakeSwap price update errors', async () => {
      pancakeSwapService.getQuote.mockRejectedValue(
        new Error('Contract Error'),
      );

      await service.updatePancakeSwapPrice();

      expect(loggingService.info).toHaveBeenCalledWith(
        'Failed to update PancakeSwap price',
        expect.objectContaining({
          component: 'PriceCalculatorService',
          error: 'Contract Error',
        }),
      );
    });
  });

  describe('Arbitrage Opportunity Detection', () => {
    beforeEach(async () => {
      // Setup MEXC price
      mexcApiService.getTicker.mockResolvedValue({
        symbol: 'ILMTUSDT',
        priceChange: '0.001',
        priceChangePercent: '2.0',
        weightedAvgPrice: '0.05',
        prevClosePrice: '0.049',
        lastPrice: '0.05',
        lastQty: '100',
        bidPrice: '0.049',
        bidQty: '1000',
        askPrice: '0.051',
        askQty: '2000',
        openPrice: '0.049',
        highPrice: '0.052',
        lowPrice: '0.048',
        volume: '1000000',
        quoteVolume: '50000',
        openTime: Date.now() - 86400000,
        closeTime: Date.now(),
        count: 1000,
      });
      mexcApiService.getBookTicker.mockResolvedValue({
        bidPrice: '0.049',
        askPrice: '0.051',
        bidQty: '1000',
        askQty: '2000',
      });

      // Setup PancakeSwap price
      pancakeSwapService.getQuote.mockResolvedValue({
        tokenIn: {
          symbol: 'USDT',
          address: '0x55d398326f99059fF775485246999027B3197955',
          decimals: 18,
        },
        tokenOut: {
          symbol: 'ILMT',
          address: '0x1234567890123456789012345678901234567890',
          decimals: 18,
        },
        amountIn: '1',
        amountOut: '18.0', // 1 USDT = 18 ILMT (lower than MEXC)
        priceImpact: '0.5',
        minimumAmountOut: '17.91',
        route: [
          '0x55d398326f99059fF775485246999027B3197955',
          '0x1234567890123456789012345678901234567890',
        ],
        gasEstimate: { gasLimit: '200000', estimatedCost: '0.01' },
      });
    });

    it('should detect arbitrage opportunity when prices differ significantly', async () => {
      await service.updateMexcPrice();
      await service.updatePancakeSwapPrice();

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'opportunity.detected',
        expect.objectContaining({
          symbol: 'ILMTUSDT',
          buyExchange: 'PANCAKESWAP',
          sellExchange: 'MEXC',
          spreadPercentage: expect.any(Number),
          netProfitPercentage: expect.any(Number),
          confidence: expect.any(String),
          riskLevel: expect.any(String),
        }),
      );

      expect(loggingService.info).toHaveBeenCalledWith(
        'Arbitrage opportunity detected',
        expect.objectContaining({
          component: 'PriceCalculatorService',
          opportunityId: expect.any(String),
        }),
      );
    });

    it('should not detect opportunity when spread is below threshold', async () => {
      // Update config to require higher minimum spread
      service.updateConfig({ minSpread: 10.0 });

      await service.updateMexcPrice();
      await service.updatePancakeSwapPrice();

      // Should not emit opportunity.detected event
      expect(eventEmitter.emit).not.toHaveBeenCalledWith(
        'opportunity.detected',
        expect.anything(),
      );
    });

    it('should provide current opportunity', async () => {
      await service.updateMexcPrice();
      await service.updatePancakeSwapPrice();

      const opportunity = service.getCurrentOpportunity();

      if (opportunity) {
        expect(opportunity).toMatchObject({
          symbol: 'ILMTUSDT',
          buyExchange: expect.any(String),
          sellExchange: expect.any(String),
          spreadPercentage: expect.any(Number),
          netProfitPercentage: expect.any(Number),
        });
      }
    });
  });

  describe('Price Data Management', () => {
    it('should return current prices', async () => {
      await service.updateMexcPrice();
      await service.updatePancakeSwapPrice();

      const prices = service.getCurrentPrices();

      expect(prices.mexc).toMatchObject({
        exchange: 'MEXC',
        symbol: 'ILMTUSDT',
        bidPrice: expect.any(Number),
        askPrice: expect.any(Number),
      });

      expect(prices.pancakeswap).toMatchObject({
        exchange: 'PANCAKESWAP',
        symbol: 'ILMTUSDT',
        bidPrice: expect.any(Number),
        askPrice: expect.any(Number),
      });
    });

    it('should handle missing price data gracefully', () => {
      const prices = service.getCurrentPrices();

      expect(prices.mexc).toBeNull();
      expect(prices.pancakeswap).toBeNull();
    });
  });

  describe('Price Updates Lifecycle', () => {
    it('should start price updates', async () => {
      await service.startPriceUpdates();

      expect(loggingService.info).toHaveBeenCalledWith(
        'Starting price updates',
        expect.objectContaining({
          component: 'PriceCalculatorService',
          interval: expect.any(Number),
        }),
      );

      // Should have called initial price updates
      expect(mexcApiService.getTicker).toHaveBeenCalled();
      expect(pancakeSwapService.getQuote).toHaveBeenCalled();
    });

    it('should stop price updates', () => {
      service.stopPriceUpdates();

      expect(loggingService.info).toHaveBeenCalledWith(
        'Stopping price updates',
        expect.objectContaining({
          component: 'PriceCalculatorService',
        }),
      );

      // Prices should be reset
      const prices = service.getCurrentPrices();
      expect(prices.mexc).toBeNull();
      expect(prices.pancakeswap).toBeNull();

      const opportunity = service.getCurrentOpportunity();
      expect(opportunity).toBeNull();
    });
  });

  describe('Opportunity Validation', () => {
    it('should validate opportunity constraints', async () => {
      // Setup a high-risk scenario
      pancakeSwapService.getQuote.mockResolvedValue({
        tokenIn: {
          symbol: 'USDT',
          address: '0x55d398326f99059fF775485246999027B3197955',
          decimals: 18,
        },
        tokenOut: {
          symbol: 'ILMT',
          address: '0x1234567890123456789012345678901234567890',
          decimals: 18,
        },
        amountIn: '1',
        amountOut: '100.0', // Unrealistic high spread
        priceImpact: '0.5',
        minimumAmountOut: '99.5',
        route: [
          '0x55d398326f99059fF775485246999027B3197955',
          '0x1234567890123456789012345678901234567890',
        ],
        gasEstimate: { gasLimit: '200000', estimatedCost: '0.01' },
      });

      await service.updateMexcPrice();
      await service.updatePancakeSwapPrice();

      // Should not detect opportunity due to spread being too high (exceeds maxSpread)
      expect(eventEmitter.emit).not.toHaveBeenCalledWith(
        'opportunity.detected',
        expect.anything(),
      );
    });
  });
});
