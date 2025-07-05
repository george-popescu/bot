import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { LoggingService } from '../../logging/logging.service';
import { MexcApiService } from './mexc-api.service';
import { MexcApiError } from '../../common/types';
import { of, throwError } from 'rxjs';
import { AxiosResponse } from 'axios';

describe('MexcApiService', () => {
  let service: MexcApiService;
  let httpService: jest.Mocked<HttpService>;
  let configService: jest.Mocked<ConfigService>;
  let loggingService: jest.Mocked<LoggingService>;

  const mockConfig = {
    MEXC_API_KEY: 'test_api_key_12345',
    MEXC_SECRET_KEY: 'test_secret_key_12345',
    MEXC_BASE_URL: 'https://api.mexc.com/api/v3',
    MEXC_WS_URL: 'wss://wbs-api.mexc.com/ws',
  };

  beforeEach(async () => {
    const mockHttpService = {
      request: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn((key: string) => mockConfig[key as keyof typeof mockConfig]),
    };

    const mockLoggingService = {
      logApiCall: jest.fn(),
      info: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MexcApiService,
        {
          provide: HttpService,
          useValue: mockHttpService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: LoggingService,
          useValue: mockLoggingService,
        },
      ],
    }).compile();

    service = module.get<MexcApiService>(MexcApiService);
    httpService = module.get(HttpService);
    configService = module.get(ConfigService);
    loggingService = module.get(LoggingService);

    // Reset call counts but keep the implementation
    jest.clearAllMocks();
    configService.get.mockImplementation(
      (key: string) => mockConfig[key as keyof typeof mockConfig],
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Configuration', () => {
    it('should validate config on construction', () => {
      expect(configService.get).toHaveBeenCalledWith('MEXC_API_KEY');
      expect(configService.get).toHaveBeenCalledWith('MEXC_SECRET_KEY');
      expect(configService.get).toHaveBeenCalledWith('MEXC_BASE_URL');
      expect(configService.get).toHaveBeenCalledWith('MEXC_WS_URL');
    });

    it('should throw error for invalid API key', () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'MEXC_API_KEY') return 'short';
        return mockConfig[key as keyof typeof mockConfig];
      });

      expect(
        () => new MexcApiService(httpService, configService, loggingService),
      ).toThrow('Invalid MEXC API key');
    });

    it('should throw error for invalid secret key', () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'MEXC_SECRET_KEY') return 'short';
        return mockConfig[key as keyof typeof mockConfig];
      });

      expect(
        () => new MexcApiService(httpService, configService, loggingService),
      ).toThrow('Invalid MEXC secret key');
    });

    it('should throw error for invalid base URL', () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'MEXC_BASE_URL') return 'http://invalid-url';
        return mockConfig[key as keyof typeof mockConfig];
      });

      expect(
        () => new MexcApiService(httpService, configService, loggingService),
      ).toThrow('Invalid MEXC base URL');
    });
  });

  describe('Public API Methods', () => {
    const createMockResponse = <T>(data: T): AxiosResponse<T> => ({
      data,
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {} as any,
      request: {},
    });

    describe('ping', () => {
      it('should return true on successful ping', async () => {
        httpService.request.mockReturnValue(of(createMockResponse({})));

        const result = await service.ping();

        expect(result).toBe(true);
        expect(httpService.request).toHaveBeenCalledWith(
          expect.objectContaining({
            method: 'GET',
            url: 'https://api.mexc.com/api/v3/ping',
          }),
        );
        expect(loggingService.logApiCall).toHaveBeenCalledWith(
          'MexcApiService',
          'ping',
          expect.any(Number),
          true,
        );
      });

      it('should return false on failed ping', async () => {
        httpService.request.mockReturnValue(
          throwError(() => new Error('Network error')),
        );

        const result = await service.ping();

        expect(result).toBe(false);
        expect(loggingService.logApiCall).toHaveBeenCalledWith(
          'MexcApiService',
          'ping',
          expect.any(Number),
          false,
          'Network error',
        );
      });
    });

    describe('getServerTime', () => {
      it('should return server time', async () => {
        const mockTime = Date.now();
        httpService.request.mockReturnValue(
          of(createMockResponse({ serverTime: mockTime })),
        );

        const result = await service.getServerTime();

        expect(result).toBe(mockTime);
        expect(httpService.request).toHaveBeenCalledWith(
          expect.objectContaining({
            method: 'GET',
            url: 'https://api.mexc.com/api/v3/time',
          }),
        );
      });

      it('should handle server time error', async () => {
        httpService.request.mockReturnValue(
          throwError(() => new Error('Server error')),
        );

        await expect(service.getServerTime()).rejects.toThrow(MexcApiError);
      });
    });

    describe('getTicker', () => {
      it('should return ticker data', async () => {
        const mockTicker = {
          symbol: 'ILMTUSDT',
          lastPrice: '0.05',
          bidPrice: '0.049',
          askPrice: '0.051',
          volume: '1000000',
          priceChange: '0.001',
          priceChangePercent: '2.04',
        };

        httpService.request.mockReturnValue(of(createMockResponse(mockTicker)));

        const result = await service.getTicker('ILMTUSDT');

        expect(result).toEqual(mockTicker);
        expect(httpService.request).toHaveBeenCalledWith(
          expect.objectContaining({
            method: 'GET',
            url: 'https://api.mexc.com/api/v3/ticker/price',
            params: { symbol: 'ILMTUSDT' },
          }),
        );
      });
    });

    describe('getBookTicker', () => {
      it('should return book ticker data', async () => {
        const mockBookTicker = {
          symbol: 'ILMTUSDT',
          bidPrice: '0.049',
          bidQty: '1000',
          askPrice: '0.051',
          askQty: '2000',
        };

        httpService.request.mockReturnValue(
          of(createMockResponse(mockBookTicker)),
        );

        const result = await service.getBookTicker('ILMTUSDT');

        expect(result).toEqual({
          bidPrice: '0.049',
          bidQty: '1000',
          askPrice: '0.051',
          askQty: '2000',
        });
      });
    });

    describe('getOrderBook', () => {
      it('should return order book data', async () => {
        const mockOrderBook = {
          symbol: 'ILMTUSDT',
          bids: [
            ['0.049', '1000'],
            ['0.048', '2000'],
          ],
          asks: [
            ['0.051', '1500'],
            ['0.052', '2500'],
          ],
          lastUpdateId: 123456,
        };

        httpService.request.mockReturnValue(
          of(createMockResponse(mockOrderBook)),
        );

        const result = await service.getOrderBook('ILMTUSDT', 100);

        expect(result).toEqual(mockOrderBook);
        expect(httpService.request).toHaveBeenCalledWith(
          expect.objectContaining({
            method: 'GET',
            url: 'https://api.mexc.com/api/v3/depth',
            params: { symbol: 'ILMTUSDT', limit: 100 },
          }),
        );
      });
    });
  });

  describe('Private API Methods', () => {
    const createMockResponse = <T>(data: T): AxiosResponse<T> => ({
      data,
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {} as any,
      request: {},
    });

    describe('getAccount', () => {
      it('should return account data with signed request', async () => {
        const mockAccount = {
          makerCommission: 15,
          takerCommission: 15,
          buyerCommission: 0,
          sellerCommission: 0,
          canTrade: true,
          canWithdraw: true,
          canDeposit: true,
          updateTime: Date.now(),
          accountType: 'SPOT',
          balances: [
            { asset: 'USDT', free: '1000.00', locked: '0.00' },
            { asset: 'ILMT', free: '500.00', locked: '0.00' },
          ],
        };

        httpService.request.mockReturnValue(
          of(createMockResponse(mockAccount)),
        );

        const result = await service.getAccount();

        expect(result).toEqual(mockAccount);
        expect(httpService.request).toHaveBeenCalledWith(
          expect.objectContaining({
            method: 'GET',
            url: 'https://api.mexc.com/api/v3/account',
            params: expect.objectContaining({
              timestamp: expect.any(Number),
              signature: expect.any(String),
            }),
          }),
        );
      });
    });

    describe('placeOrder', () => {
      it('should place order successfully', async () => {
        const mockOrder = {
          symbol: 'ILMTUSDT',
          orderId: 123456,
          orderListId: -1,
          clientOrderId: 'test-order-123',
          transactTime: Date.now(),
          price: '0.05',
          origQty: '100',
          executedQty: '0',
          cummulativeQuoteQty: '0',
          status: 'NEW' as const,
          timeInForce: 'GTC',
          type: 'LIMIT',
          side: 'BUY',
        };

        httpService.request.mockReturnValue(of(createMockResponse(mockOrder)));

        const orderRequest = {
          symbol: 'ILMTUSDT',
          side: 'BUY' as const,
          type: 'LIMIT' as const,
          timeInForce: 'GTC' as const,
          quantity: '100',
          price: '0.05',
        };

        const result = await service.placeOrder(orderRequest);

        expect(result).toEqual(mockOrder);
        expect(httpService.request).toHaveBeenCalledWith(
          expect.objectContaining({
            method: 'POST',
            url: 'https://api.mexc.com/api/v3/order',
            data: expect.objectContaining({
              ...orderRequest,
              timestamp: expect.any(Number),
              recvWindow: 5000,
              signature: expect.any(String),
            }),
          }),
        );
        expect(loggingService.info).toHaveBeenCalledWith(
          'Order placed successfully',
          expect.objectContaining({
            component: 'MexcApiService',
            operation: 'PLACE_ORDER',
            orderId: 123456,
            symbol: 'ILMTUSDT',
            side: 'BUY',
            type: 'LIMIT',
          }),
        );
      });
    });

    describe('cancelOrder', () => {
      it('should cancel order successfully', async () => {
        const mockCancelResponse = {
          symbol: 'ILMTUSDT',
          orderId: 123456,
          status: 'CANCELED' as const,
        };

        httpService.request.mockReturnValue(
          of(createMockResponse(mockCancelResponse)),
        );

        const result = await service.cancelOrder('ILMTUSDT', 123456);

        expect(result).toEqual(mockCancelResponse);
        expect(httpService.request).toHaveBeenCalledWith(
          expect.objectContaining({
            method: 'DELETE',
            url: 'https://api.mexc.com/api/v3/order',
            data: expect.objectContaining({
              symbol: 'ILMTUSDT',
              orderId: 123456,
              timestamp: expect.any(Number),
              signature: expect.any(String),
            }),
          }),
        );
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle rate limit errors', async () => {
      const rateLimitError = {
        response: {
          status: 429,
          data: { code: -1003, msg: 'Too many requests' },
        },
      };

      httpService.request.mockReturnValue(throwError(() => rateLimitError));

      await expect(service.ping()).resolves.toBe(false);
      expect(loggingService.logApiCall).toHaveBeenCalledWith(
        'MexcApiService',
        'ping',
        expect.any(Number),
        false,
        expect.stringContaining('Rate limit exceeded'),
      );
    });

    it('should handle network errors', async () => {
      const networkError = {
        code: 'ENOTFOUND',
        message: 'getaddrinfo ENOTFOUND api.mexc.com',
      };

      httpService.request.mockReturnValue(throwError(() => networkError));

      await expect(service.getServerTime()).rejects.toThrow(MexcApiError);
    });

    it('should handle timeout errors', async () => {
      const timeoutError = {
        code: 'ECONNABORTED',
        message: 'timeout of 10000ms exceeded',
      };

      httpService.request.mockReturnValue(throwError(() => timeoutError));

      await expect(service.getServerTime()).rejects.toThrow(MexcApiError);
    });
  });

  describe('Rate Limiting', () => {
    it('should track rate limits', () => {
      const rateLimitStatus = service.getRateLimitStatus();

      expect(rateLimitStatus).toHaveProperty('remaining');
      expect(rateLimitStatus).toHaveProperty('resetTime');
      expect(rateLimitStatus.remaining).toBeGreaterThanOrEqual(0);
      expect(rateLimitStatus.resetTime).toBeGreaterThan(Date.now());
    });

    it('should provide connection status', () => {
      const isConnected = service.isConnected();
      expect(typeof isConnected).toBe('boolean');
    });

    it('should return partial config', () => {
      const config = service.getConfig();

      expect(config).toHaveProperty('baseUrl');
      expect(config).toHaveProperty('timeout');
      expect(config).toHaveProperty('maxRetries');
      expect(config).not.toHaveProperty('apiKey');
      expect(config).not.toHaveProperty('secretKey');
    });
  });
});
