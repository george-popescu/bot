import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LoggingService } from './logging.service';
import { Trade, ArbitrageOpportunity } from '../common/types';

describe('LoggingService', () => {
  let service: LoggingService;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoggingService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<LoggingService>(LoggingService);
    configService = module.get(ConfigService);
  });

  beforeEach(() => {
    configService.get.mockImplementation((key: string, defaultValue?: any) => {
      const values: { [key: string]: any } = {
        LOG_LEVEL: 'info',
        NODE_ENV: 'test',
        BOT_ENABLED: false,
      };
      return values[key] || defaultValue;
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('NestJS LoggerService interface', () => {
    let winstonSpy: jest.SpyInstance;

    beforeEach(() => {
      winstonSpy = jest
        .spyOn((service as any).logger, 'info')
        .mockImplementation();
    });

    afterEach(() => {
      winstonSpy.mockRestore();
    });

    it('should implement log method', () => {
      service.log('test message', 'TestContext');
      expect(winstonSpy).toHaveBeenCalledWith('test message', {
        context: { component: 'TestContext' },
      });
    });

    it('should implement error method', () => {
      const errorSpy = jest
        .spyOn((service as any).logger, 'error')
        .mockImplementation();
      service.error('test error', 'stack trace', 'TestContext');
      expect(errorSpy).toHaveBeenCalledWith('test error', {
        context: { component: 'TestContext' },
        stack: 'stack trace',
      });
      errorSpy.mockRestore();
    });

    it('should implement warn method', () => {
      const warnSpy = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation();
      service.warn('test warning', 'TestContext');
      expect(warnSpy).toHaveBeenCalledWith('test warning', {
        context: { component: 'TestContext' },
      });
      warnSpy.mockRestore();
    });

    it('should implement debug method', () => {
      const debugSpy = jest
        .spyOn((service as any).logger, 'debug')
        .mockImplementation();
      service.debug('test debug', 'TestContext');
      expect(debugSpy).toHaveBeenCalledWith('test debug', {
        context: { component: 'TestContext' },
      });
      debugSpy.mockRestore();
    });
  });

  describe('Custom logging methods', () => {
    let winstonInfoSpy: jest.SpyInstance;
    let winstonDebugSpy: jest.SpyInstance;

    beforeEach(() => {
      winstonInfoSpy = jest
        .spyOn((service as any).logger, 'info')
        .mockImplementation();
      winstonDebugSpy = jest
        .spyOn((service as any).logger, 'debug')
        .mockImplementation();
    });

    afterEach(() => {
      winstonInfoSpy.mockRestore();
      winstonDebugSpy.mockRestore();
    });

    it('should log trade execution', () => {
      const mockTrade: Trade = {
        id: 'trade-123',
        pair: 'ILMTUSDT',
        direction: 'CEX_TO_DEX',
        profit: 5.0,
        profitUsd: 5.0,
        executedAt: new Date(),
        mexcOrderId: 'mexc-123',
        bscTxHash: '0x123',
        mexcSide: 'BUY',
        mexcQuantity: 100,
        mexcPrice: 0.05,
        dexAmountIn: 5,
        dexAmountOut: 100,
        executionTimeMs: 1500,
        status: 'SUCCESS',
      };

      service.logTrade(mockTrade);
      expect(winstonInfoSpy).toHaveBeenCalledWith(
        'Trade executed',
        expect.objectContaining({
          context: expect.objectContaining({
            component: 'ArbitrageService',
            operation: 'TRADE_EXECUTED',
            tradeId: 'trade-123',
          }),
        }),
      );
    });

    it('should log arbitrage opportunity', () => {
      const mockOpportunity: ArbitrageOpportunity = {
        id: 'opp-123',
        pair: 'ILMTUSDT',
        mexcPrice: 0.05,
        dexPrice: 0.052,
        spread: 0.002,
        spreadPercent: 4.0,
        direction: 'CEX_TO_DEX',
        estimatedProfitUsd: 2.0,
        tradeSize: 100,
        executable: true,
        detectedAt: new Date(),
        fees: {
          mexcFee: 0.025,
          dexFee: 0.125,
          gasCost: 0.1,
          totalFees: 0.25,
        },
      };

      service.logOpportunity(mockOpportunity, true);
      expect(winstonInfoSpy).toHaveBeenCalled();
    });

    it('should log price updates', () => {
      service.logPriceUpdate(0.05, 0.052, 0.002, 'ILMTUSDT');
      expect(winstonDebugSpy).toHaveBeenCalled();
    });

    it('should log API calls', () => {
      service.logApiCall('MexcService', 'getTicker', 150, true);
      expect(winstonDebugSpy).toHaveBeenCalled();

      const warnSpy = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation();
      service.logApiCall(
        'MexcService',
        'placeOrder',
        300,
        false,
        'Insufficient balance',
      );
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('should log balance updates', () => {
      const balances = {
        USDT: 1000,
        ILMT: 500,
        BNB: 1.5,
      };

      service.logBalanceUpdate('MEXC', balances);
      expect(winstonInfoSpy).toHaveBeenCalled();
    });

    it('should log system errors', () => {
      const error = new Error('Test error message');
      const context = {
        component: 'TestService',
        operation: 'test_operation',
      };

      const errorSpy = jest
        .spyOn((service as any).logger, 'error')
        .mockImplementation();
      service.logSystemError(error, context);
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('should log WebSocket events', () => {
      service.logWebSocketEvent('connected', true);
      expect(winstonDebugSpy).toHaveBeenCalled();

      const warnSpy = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation();
      service.logWebSocketEvent('error', false, {
        reason: 'Connection timeout',
      });
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('should log performance metrics', () => {
      service.logPerformanceMetric('arbitrage_execution', 1234, {
        component: 'ArbitrageService',
        tradeId: 'trade-123',
      });
      expect(winstonInfoSpy).toHaveBeenCalled();
    });
  });

  describe('Configuration', () => {
    it('should handle different environments', () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'development';
        if (key === 'LOG_LEVEL') return 'debug';
        return undefined;
      });

      const devService = new LoggingService(configService);
      expect(devService).toBeDefined();
    });

    it('should support log level changes', () => {
      service.setLogLevel('debug');
      expect(service.getLogLevel()).toBe('debug');

      service.setLogLevel('error');
      expect(service.getLogLevel()).toBe('error');
    });
  });

  describe('Child logger creation', () => {
    it('should create child logger with default context', () => {
      const defaultContext = {
        component: 'TestService',
        tradeId: 'trade-123',
      };

      const childLogger = service.createChildLogger(defaultContext);
      expect(childLogger).toBeDefined();
    });
  });
});
