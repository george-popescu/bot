import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { LoggingService } from '../../logging/logging.service';
import { MexcWebSocketService } from './mexc-websocket.service';
import WebSocket from 'ws';

// Mock WebSocket
jest.mock('ws');

describe('MexcWebSocketService', () => {
  let service: MexcWebSocketService;
  let eventEmitter: jest.Mocked<EventEmitter2>;
  let configService: jest.Mocked<ConfigService>;
  let loggingService: jest.Mocked<LoggingService>;
  let mockWebSocket: jest.Mocked<WebSocket>;

  const mockConfig = {
    MEXC_WS_URL: 'wss://wbs-api.mexc.com/ws',
  };

  beforeEach(async () => {
    const mockEventEmitter = {
      emit: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn((key: string) => mockConfig[key as keyof typeof mockConfig]),
    };

    const mockLoggingService = {
      logWebSocketEvent: jest.fn(),
    };

    // Create mock WebSocket instance
    mockWebSocket = {
      readyState: WebSocket.OPEN,
      send: jest.fn(),
      close: jest.fn(),
      ping: jest.fn(),
      on: jest.fn(),
      once: jest.fn(),
      removeAllListeners: jest.fn(),
      CONNECTING: WebSocket.CONNECTING,
      OPEN: WebSocket.OPEN,
      CLOSING: WebSocket.CLOSING,
      CLOSED: WebSocket.CLOSED,
    } as any;

    // Mock WebSocket constructor
    (WebSocket as jest.MockedClass<typeof WebSocket>).mockImplementation(
      () => mockWebSocket as any,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MexcWebSocketService,
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
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

    service = module.get<MexcWebSocketService>(MexcWebSocketService);
    eventEmitter = module.get(EventEmitter2);
    configService = module.get(ConfigService);
    loggingService = module.get(LoggingService);
  });

  beforeEach(() => {
    configService.get.mockImplementation(
      (key: string) => mockConfig[key as keyof typeof mockConfig],
    );
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Configuration', () => {
    it('should validate WebSocket URL on construction', () => {
      expect(configService.get).toHaveBeenCalledWith('MEXC_WS_URL');
    });

    it('should throw error for invalid WebSocket URL', () => {
      configService.get.mockReturnValue('ws://invalid-url');

      expect(
        () =>
          new MexcWebSocketService(configService, loggingService, eventEmitter),
      ).toThrow('Invalid MEXC WebSocket URL');
    });

    it('should throw error for missing WebSocket URL', () => {
      configService.get.mockReturnValue(undefined);

      expect(
        () =>
          new MexcWebSocketService(configService, loggingService, eventEmitter),
      ).toThrow('Invalid MEXC WebSocket URL');
    });
  });

  describe('Connection Management', () => {
    it('should connect successfully', async () => {
      const connectPromise = service.connect();

      // Simulate successful connection
      const openCallback = mockWebSocket.once.mock.calls.find(
        (call) => call[0] === 'open',
      )?.[1] as Function;
      if (openCallback) {
        openCallback();
      }

      await connectPromise;

      expect(WebSocket).toHaveBeenCalledWith('wss://wbs-api.mexc.com/ws');
      expect(mockWebSocket.once).toHaveBeenCalledWith(
        'open',
        expect.any(Function),
      );
      expect(loggingService.logWebSocketEvent).toHaveBeenCalledWith(
        'connected',
        true,
      );
    });

    it('should handle connection timeout', async () => {
      jest.useFakeTimers();

      const connectPromise = service.connect();

      // Fast-forward past timeout (10 seconds)
      jest.advanceTimersByTime(10001);

      await expect(connectPromise).rejects.toThrow(
        'WebSocket connection timeout',
      );

      jest.useRealTimers();
    });

    it('should handle connection error', async () => {
      const connectPromise = service.connect();
      const error = new Error('Connection failed');

      // Simulate connection error
      const errorCallback = mockWebSocket.once.mock.calls.find(
        (call) => call[0] === 'error',
      )?.[1] as Function;
      if (errorCallback) {
        errorCallback(error);
      }

      await expect(connectPromise).rejects.toThrow('Connection failed');
      expect(loggingService.logWebSocketEvent).toHaveBeenCalledWith(
        'connection_error',
        false,
        { error: 'Connection failed' },
      );
    });

    it('should disconnect properly', async () => {
      // First connect
      const connectPromise = service.connect();
      const openCallback = mockWebSocket.once.mock.calls.find(
        (call) => call[0] === 'open',
      )?.[1] as Function;
      if (openCallback) {
        openCallback();
      }
      await connectPromise;

      // Then disconnect
      await service.disconnect();

      expect(mockWebSocket.removeAllListeners).toHaveBeenCalled();
      expect(mockWebSocket.close).toHaveBeenCalledWith(
        1000,
        'Service shutdown',
      );
      expect(loggingService.logWebSocketEvent).toHaveBeenCalledWith(
        'disconnected',
        true,
      );
    });

    it('should not connect if already connecting', async () => {
      const connectPromise1 = service.connect();
      const connectPromise2 = service.connect();

      const openCallback = mockWebSocket.once.mock.calls.find(
        (call) => call[0] === 'open',
      )?.[1] as Function;
      if (openCallback) {
        openCallback();
      }

      await Promise.all([connectPromise1, connectPromise2]);

      // Should only create one WebSocket instance
      expect(WebSocket).toHaveBeenCalledTimes(1);
    });
  });

  describe('Message Handling', () => {
    beforeEach(async () => {
      // Connect first
      const connectPromise = service.connect();
      const openCallback = mockWebSocket.once.mock.calls.find(
        (call) => call[0] === 'open',
      )?.[1] as Function;
      if (openCallback) {
        openCallback();
      }
      await connectPromise;
    });

    it('should handle book ticker messages', () => {
      const mockBookTicker = {
        stream: 'ilmtusdt@bookTicker',
        data: {
          u: 123456,
          s: 'ILMTUSDT',
          b: '0.049',
          B: '1000',
          a: '0.051',
          A: '2000',
        },
      };

      // Get the message handler
      const messageHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === 'message',
      )?.[1] as Function;
      expect(messageHandler).toBeDefined();

      // Simulate receiving a message
      messageHandler(JSON.stringify(mockBookTicker));

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'mexc.price.update',
        expect.objectContaining({
          symbol: 'ILMTUSDT',
          price: 0.05, // (0.049 + 0.051) / 2
          bid: 0.049,
          ask: 0.051,
          source: 'WS',
        }),
      );

      expect(loggingService.logWebSocketEvent).toHaveBeenCalledWith(
        'book_ticker_received',
        true,
        expect.objectContaining({
          symbol: 'ILMTUSDT',
          bidPrice: 0.049,
          askPrice: 0.051,
          midPrice: 0.05,
        }),
      );
    });

    it('should handle trade messages', () => {
      const mockTrade = {
        stream: 'ilmtusdt@trade',
        data: {
          e: 'trade',
          E: Date.now(),
          s: 'ILMTUSDT',
          t: 123456,
          p: '0.05',
          q: '100',
          b: 789,
          a: 456,
          T: Date.now(),
          m: true,
          M: false,
        },
      };

      const messageHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === 'message',
      )?.[1] as Function;
      messageHandler(JSON.stringify(mockTrade));

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'mexc.trade.executed',
        expect.objectContaining({
          symbol: 'ILMTUSDT',
          tradeId: 123456,
          price: 0.05,
          quantity: 100,
          isBuyerMaker: true,
        }),
      );
    });

    it('should handle depth messages', () => {
      const mockDepth = {
        stream: 'ilmtusdt@depth',
        data: {
          e: 'depthUpdate',
          E: Date.now(),
          s: 'ILMTUSDT',
          U: 123456,
          u: 123460,
          b: [
            ['0.049', '1000'],
            ['0.048', '2000'],
          ],
          a: [
            ['0.051', '1500'],
            ['0.052', '2500'],
          ],
        },
      };

      const messageHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === 'message',
      )?.[1] as Function;
      messageHandler(JSON.stringify(mockDepth));

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'mexc.depth.update',
        expect.objectContaining({
          symbol: 'ILMTUSDT',
          bids: [
            [0.049, 1000],
            [0.048, 2000],
          ],
          asks: [
            [0.051, 1500],
            [0.052, 2500],
          ],
        }),
      );
    });

    it('should handle invalid JSON messages gracefully', () => {
      const messageHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === 'message',
      )?.[1] as Function;
      messageHandler('invalid json');

      expect(loggingService.logWebSocketEvent).toHaveBeenCalledWith(
        'message_parse_error',
        false,
        expect.objectContaining({
          error: expect.stringContaining('Unexpected token'),
        }),
      );
    });

    it('should handle subscription responses', () => {
      const mockSubscriptionResponse = {
        id: 123456,
        result: null,
      };

      const messageHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === 'message',
      )?.[1] as Function;
      messageHandler(JSON.stringify(mockSubscriptionResponse));

      expect(loggingService.logWebSocketEvent).toHaveBeenCalledWith(
        'subscription_success',
        true,
        { id: 123456 },
      );
    });
  });

  describe('Subscription Management', () => {
    beforeEach(async () => {
      // Connect first
      const connectPromise = service.connect();
      const openCallback = mockWebSocket.once.mock.calls.find(
        (call) => call[0] === 'open',
      )?.[1] as Function;
      if (openCallback) {
        openCallback();
      }
      await connectPromise;
    });

    it('should subscribe to book ticker', async () => {
      await service.subscribeToBookTicker('ILMTUSDT');

      expect(mockWebSocket.send).toHaveBeenCalledWith(
        JSON.stringify({
          id: expect.any(Number),
          method: 'SUBSCRIBE',
          params: ['ilmtusdt@bookTicker'],
        }),
      );

      expect(loggingService.logWebSocketEvent).toHaveBeenCalledWith(
        'subscription_sent',
        true,
        { stream: 'ilmtusdt@bookTicker' },
      );
    });

    it('should subscribe to trades', async () => {
      await service.subscribeToTrades('ILMTUSDT');

      expect(mockWebSocket.send).toHaveBeenCalledWith(
        JSON.stringify({
          id: expect.any(Number),
          method: 'SUBSCRIBE',
          params: ['ilmtusdt@trade'],
        }),
      );
    });

    it('should subscribe to depth', async () => {
      await service.subscribeToDepth('ILMTUSDT', 20);

      expect(mockWebSocket.send).toHaveBeenCalledWith(
        JSON.stringify({
          id: expect.any(Number),
          method: 'SUBSCRIBE',
          params: ['ilmtusdt@depth20'],
        }),
      );
    });

    it('should not subscribe twice to the same stream', async () => {
      await service.subscribeToBookTicker('ILMTUSDT');
      await service.subscribeToBookTicker('ILMTUSDT');

      expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
      expect(loggingService.logWebSocketEvent).toHaveBeenCalledWith(
        'already_subscribed',
        false,
        { stream: 'ilmtusdt@bookTicker' },
      );
    });

    it('should unsubscribe from streams', async () => {
      await service.subscribeToBookTicker('ILMTUSDT');
      await service.unsubscribe('ilmtusdt@bookTicker');

      expect(mockWebSocket.send).toHaveBeenLastCalledWith(
        JSON.stringify({
          id: expect.any(Number),
          method: 'UNSUBSCRIBE',
          params: ['ilmtusdt@bookTicker'],
        }),
      );

      expect(loggingService.logWebSocketEvent).toHaveBeenCalledWith(
        'unsubscription_sent',
        true,
        { stream: 'ilmtusdt@bookTicker' },
      );
    });
  });

  describe('Status and Health', () => {
    it('should report connection status', () => {
      expect(service.isConnected()).toBe(false);
      expect(service.getConnectionState()).toBe('DISCONNECTED');
    });

    it('should report connected state when WebSocket is open', async () => {
      const connectPromise = service.connect();
      const openCallback = mockWebSocket.once.mock.calls.find(
        (call) => call[0] === 'open',
      )?.[1] as Function;
      if (openCallback) {
        openCallback();
      }
      await connectPromise;

      expect(service.isConnected()).toBe(true);
      expect(service.getConnectionState()).toBe('CONNECTED');
    });

    it('should return subscriptions list', async () => {
      const connectPromise = service.connect();
      const openCallback = mockWebSocket.once.mock.calls.find(
        (call) => call[0] === 'open',
      )?.[1] as Function;
      if (openCallback) {
        openCallback();
      }
      await connectPromise;

      await service.subscribeToBookTicker('ILMTUSDT');
      await service.subscribeToTrades('ILMTUSDT');

      const subscriptions = service.getSubscriptions();
      expect(subscriptions).toHaveLength(2);
      expect(subscriptions[0]).toHaveProperty('stream');
      expect(subscriptions[0]).toHaveProperty('symbol');
      expect(subscriptions[0]).toHaveProperty('subscribed', true);
    });

    it('should report health status', () => {
      expect(service.isHealthy()).toBe(false); // Not connected
    });

    it('should report reconnect attempts', () => {
      expect(service.getReconnectAttempts()).toBe(0);
    });
  });

  describe('Reconnection Logic', () => {
    it('should handle WebSocket close event', async () => {
      jest.useFakeTimers();

      const connectPromise = service.connect();
      const openCallback = mockWebSocket.once.mock.calls.find(
        (call) => call[0] === 'open',
      )?.[1] as Function;
      if (openCallback) {
        openCallback();
      }
      await connectPromise;

      // Simulate close event
      const closeCallback = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === 'close',
      )?.[1] as Function;
      if (closeCallback) {
        closeCallback(1006, 'Connection lost');
      }

      expect(loggingService.logWebSocketEvent).toHaveBeenCalledWith(
        'close',
        true,
        { code: 1006, reason: 'Connection lost' },
      );

      jest.useRealTimers();
    });
  });

  describe('Module Destruction', () => {
    it('should clean up on module destroy', async () => {
      const connectPromise = service.connect();
      const openCallback = mockWebSocket.once.mock.calls.find(
        (call) => call[0] === 'open',
      )?.[1] as Function;
      if (openCallback) {
        openCallback();
      }
      await connectPromise;

      await service.onModuleDestroy();

      expect(mockWebSocket.removeAllListeners).toHaveBeenCalled();
      expect(mockWebSocket.close).toHaveBeenCalledWith(
        1000,
        'Service shutdown',
      );
    });
  });
});
