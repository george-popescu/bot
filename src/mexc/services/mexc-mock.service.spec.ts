import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LoggingService } from '../../logging/logging.service';
import { MexcMockService } from './mexc-mock.service';

describe('MexcMockService', () => {
  let service: MexcMockService;
  let eventEmitter: jest.Mocked<EventEmitter2>;
  let loggingService: jest.Mocked<LoggingService>;

  beforeEach(async () => {
    const mockEventEmitter = {
      emit: jest.fn(),
    };

    const mockLoggingService = {
      info: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MexcMockService,
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
        {
          provide: LoggingService,
          useValue: mockLoggingService,
        },
      ],
    }).compile();

    service = module.get<MexcMockService>(MexcMockService);
    eventEmitter = module.get(EventEmitter2);
    loggingService = module.get(LoggingService);
  });

  afterEach(() => {
    service.stopMockPriceUpdates();
    service.resetMockData();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Basic API Methods', () => {
    it('should ping successfully', async () => {
      const result = await service.ping();
      expect(result).toBe(true);
    });

    it('should return server time', async () => {
      const result = await service.getServerTime();
      expect(typeof result).toBe('number');
      expect(result).toBeCloseTo(Date.now(), -2); // Within 100ms
    });

    it('should return realistic ticker data', async () => {
      const ticker = await service.getTicker('ILMTUSDT');

      expect(ticker).toHaveProperty('symbol', 'ILMTUSDT');
      expect(ticker).toHaveProperty('lastPrice');
      expect(ticker).toHaveProperty('bidPrice');
      expect(ticker).toHaveProperty('askPrice');
      expect(ticker).toHaveProperty('volume');
      expect(parseFloat(ticker.lastPrice)).toBeGreaterThan(0);
      expect(parseFloat(ticker.bidPrice)).toBeLessThan(
        parseFloat(ticker.askPrice),
      );
    });

    it('should return book ticker data', async () => {
      const bookTicker = await service.getBookTicker('ILMTUSDT');

      expect(bookTicker).toHaveProperty('bidPrice');
      expect(bookTicker).toHaveProperty('bidQty');
      expect(bookTicker).toHaveProperty('askPrice');
      expect(bookTicker).toHaveProperty('askQty');
      expect(parseFloat(bookTicker.bidPrice)).toBeLessThan(
        parseFloat(bookTicker.askPrice),
      );
    });

    it('should return account data with balances', async () => {
      const account = await service.getAccount();

      expect(account).toHaveProperty('canTrade', true);
      expect(account).toHaveProperty('balances');
      expect(Array.isArray(account.balances)).toBe(true);
      expect(account.balances.length).toBeGreaterThan(0);

      const usdtBalance = account.balances.find((b) => b.asset === 'USDT');
      expect(usdtBalance).toBeDefined();
      expect(parseFloat(usdtBalance!.free)).toBeGreaterThan(0);
    });
  });

  describe('Order Management', () => {
    it('should place market order successfully', async () => {
      const orderRequest = {
        symbol: 'ILMTUSDT',
        side: 'BUY' as const,
        type: 'MARKET' as const,
        quantity: '100',
      };

      const order = await service.placeOrder(orderRequest);

      expect(order).toHaveProperty('symbol', 'ILMTUSDT');
      expect(order).toHaveProperty('side', 'BUY');
      expect(order).toHaveProperty('type', 'MARKET');
      expect(order).toHaveProperty('status', 'FILLED');
      expect(order).toHaveProperty('orderId');
      expect(order.orderId).toBeGreaterThan(0);

      expect(loggingService.info).toHaveBeenCalledWith(
        'Mock order placed',
        expect.objectContaining({
          component: 'MexcMockService',
          operation: 'PLACE_ORDER',
          orderId: order.orderId,
        }),
      );
    });

    it('should place limit order successfully', async () => {
      const orderRequest = {
        symbol: 'ILMTUSDT',
        side: 'SELL' as const,
        type: 'LIMIT' as const,
        quantity: '50',
        price: '0.06',
        timeInForce: 'GTC' as const,
      };

      const order = await service.placeOrder(orderRequest);

      expect(order).toHaveProperty('status', 'NEW');
      expect(order).toHaveProperty('price', '0.06');
      expect(order).toHaveProperty('timeInForce', 'GTC');
      expect(order).toHaveProperty('isWorking', true);
    });

    it('should cancel order successfully', async () => {
      // First place an order
      const orderRequest = {
        symbol: 'ILMTUSDT',
        side: 'BUY' as const,
        type: 'LIMIT' as const,
        quantity: '100',
        price: '0.04',
      };

      const placedOrder = await service.placeOrder(orderRequest);

      // Then cancel it
      const cancelledOrder = await service.cancelOrder(
        'ILMTUSDT',
        placedOrder.orderId,
      );

      expect(cancelledOrder).toHaveProperty('status', 'CANCELED');
      expect(cancelledOrder).toHaveProperty('orderId', placedOrder.orderId);

      expect(loggingService.info).toHaveBeenCalledWith(
        'Mock order cancelled',
        expect.objectContaining({
          component: 'MexcMockService',
          operation: 'CANCEL_ORDER',
          orderId: placedOrder.orderId,
        }),
      );
    });

    it('should throw error when cancelling non-existent order', async () => {
      await expect(service.cancelOrder('ILMTUSDT', 999999)).rejects.toThrow(
        'Order 999999 not found',
      );
    });

    it('should get order by ID', async () => {
      const orderRequest = {
        symbol: 'ILMTUSDT',
        side: 'BUY' as const,
        type: 'MARKET' as const,
        quantity: '100',
      };

      const placedOrder = await service.placeOrder(orderRequest);
      const retrievedOrder = await service.getOrder(
        'ILMTUSDT',
        placedOrder.orderId,
      );

      expect(retrievedOrder).toEqual(placedOrder);
    });

    it('should throw error when getting non-existent order', async () => {
      await expect(service.getOrder('ILMTUSDT', 999999)).rejects.toThrow(
        'Order 999999 not found',
      );
    });

    it('should return my trades', async () => {
      const trades = await service.getMyTrades('ILMTUSDT', 5);

      expect(Array.isArray(trades)).toBe(true);
      expect(trades.length).toBeLessThanOrEqual(5);

      if (trades.length > 0) {
        const trade = trades[0];
        expect(trade).toHaveProperty('symbol', 'ILMTUSDT');
        expect(trade).toHaveProperty('price');
        expect(trade).toHaveProperty('qty');
        expect(trade).toHaveProperty('commission');
        expect(parseFloat(trade.price)).toBeGreaterThan(0);
        expect(parseFloat(trade.qty)).toBeGreaterThan(0);
      }
    });
  });

  describe('Balance Management', () => {
    it('should update balances after market buy order', async () => {
      const initialBalances = service.getMockBalances();
      const initialUsdt = initialBalances.USDT.free;
      const initialIlmt = initialBalances.ILMT.free;

      const orderRequest = {
        symbol: 'ILMTUSDT',
        side: 'BUY' as const,
        type: 'MARKET' as const,
        quantity: '1000', // Buy 1000 ILMT
      };

      await service.placeOrder(orderRequest);

      const updatedBalances = service.getMockBalances();

      // Should have less USDT and more ILMT
      expect(updatedBalances.USDT.free).toBeLessThan(initialUsdt);
      expect(updatedBalances.ILMT.free).toBeGreaterThan(initialIlmt);
      expect(updatedBalances.ILMT.free).toBe(initialIlmt + 1000);
    });

    it('should update balances after market sell order', async () => {
      const initialBalances = service.getMockBalances();
      const initialUsdt = initialBalances.USDT.free;
      const initialIlmt = initialBalances.ILMT.free;

      const orderRequest = {
        symbol: 'ILMTUSDT',
        side: 'SELL' as const,
        type: 'MARKET' as const,
        quantity: '1000', // Sell 1000 ILMT
      };

      await service.placeOrder(orderRequest);

      const updatedBalances = service.getMockBalances();

      // Should have more USDT and less ILMT
      expect(updatedBalances.USDT.free).toBeGreaterThan(initialUsdt);
      expect(updatedBalances.ILMT.free).toBeLessThan(initialIlmt);
      expect(updatedBalances.ILMT.free).toBe(initialIlmt - 1000);
    });

    it('should apply trading fees', async () => {
      const initialBalances = service.getMockBalances();
      const initialUsdt = initialBalances.USDT.free;
      const initialIlmt = initialBalances.ILMT.free;

      const quantity = 1000;
      const orderRequest = {
        symbol: 'ILMTUSDT',
        side: 'BUY' as const,
        type: 'MARKET' as const,
        quantity: quantity.toString(),
      };

      await service.placeOrder(orderRequest);

      const updatedBalances = service.getMockBalances();

      // Should have spent some USDT and gained ILMT
      expect(updatedBalances.USDT.free).toBeLessThan(initialUsdt);
      expect(updatedBalances.ILMT.free).toBe(initialIlmt + quantity);

      // The amount spent should be more than the simple price * quantity due to fees
      const actualSpent = initialUsdt - updatedBalances.USDT.free;
      expect(actualSpent).toBeGreaterThan(quantity * 0.04); // Assuming min price around 0.04
      expect(actualSpent).toBeLessThan(quantity * 0.06); // Assuming max price around 0.06
    });
  });

  describe('Mock Price Updates', () => {
    it('should start and stop price updates', () => {
      expect(service.isUpdatesRunning()).toBe(false);

      service.startMockPriceUpdates(['ILMTUSDT']);
      expect(service.isUpdatesRunning()).toBe(true);

      service.stopMockPriceUpdates();
      expect(service.isUpdatesRunning()).toBe(false);
    });

    it('should emit price update events', (done) => {
      service.startMockPriceUpdates(['ILMTUSDT']);

      // Wait for at least one price update
      setTimeout(() => {
        expect(eventEmitter.emit).toHaveBeenCalledWith(
          'mexc.price.update',
          expect.objectContaining({
            symbol: 'ILMTUSDT',
            price: expect.any(Number),
            bid: expect.any(Number),
            ask: expect.any(Number),
            source: 'WS',
          }),
        );

        service.stopMockPriceUpdates();
        done();
      }, 2500); // Wait for 2.5 seconds (updates every 2 seconds)
    }, 3000);

    it('should not start multiple update intervals', () => {
      service.startMockPriceUpdates(['ILMTUSDT']);
      service.startMockPriceUpdates(['ILMTUSDT']); // Second call should be ignored

      expect(service.isUpdatesRunning()).toBe(true);
      service.stopMockPriceUpdates();
    });

    it('should simulate trade events', () => {
      service.simulateTrade('ILMTUSDT');

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'mexc.trade.executed',
        expect.objectContaining({
          symbol: 'ILMTUSDT',
          tradeId: expect.any(Number),
          price: expect.any(Number),
          quantity: expect.any(Number),
          isBuyerMaker: expect.any(Boolean),
        }),
      );
    });
  });

  describe('Mock Data Management', () => {
    it('should allow setting custom prices', async () => {
      const customPrice = 0.123;
      service.setMockPrice('ILMTUSDT', customPrice);

      const ticker = await service.getTicker('ILMTUSDT');
      const tickerPrice = parseFloat(ticker.lastPrice);

      // Price should be close to the set price (within 0.1% due to volatility simulation)
      expect(tickerPrice).toBeCloseTo(customPrice, 3);
    });

    it('should reset mock data', async () => {
      // Modify some data
      await service.placeOrder({
        symbol: 'ILMTUSDT',
        side: 'BUY',
        type: 'MARKET',
        quantity: '100',
      });

      service.setMockPrice('ILMTUSDT', 0.999);

      // Reset
      service.resetMockData();

      // Check that data is reset
      const orders = service.getMockOrders();
      const balances = service.getMockBalances();

      expect(orders.size).toBe(0);
      expect(balances.USDT.free).toBe(10000);
      expect(balances.ILMT.free).toBe(200000);
    });

    it('should provide access to mock orders', async () => {
      const orderRequest = {
        symbol: 'ILMTUSDT',
        side: 'BUY' as const,
        type: 'LIMIT' as const,
        quantity: '100',
        price: '0.05',
      };

      const order = await service.placeOrder(orderRequest);
      const mockOrders = service.getMockOrders();

      expect(mockOrders.has(order.orderId)).toBe(true);
      expect(mockOrders.get(order.orderId)).toEqual(order);
    });

    it('should provide access to mock balances', () => {
      const balances = service.getMockBalances();

      expect(balances).toHaveProperty('USDT');
      expect(balances).toHaveProperty('ILMT');
      expect(balances).toHaveProperty('BNB');
      expect(balances.USDT.free).toBe(10000);
      expect(balances.ILMT.free).toBe(200000);
    });
  });

  describe('Price Simulation', () => {
    it('should generate realistic price movements', async () => {
      const prices: number[] = [];

      // Get multiple ticker prices to see price movement
      for (let i = 0; i < 10; i++) {
        const ticker = await service.getTicker('ILMTUSDT');
        prices.push(parseFloat(ticker.lastPrice));
      }

      // Prices should vary but stay within reasonable bounds
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const priceRange = maxPrice - minPrice;

      expect(priceRange).toBeGreaterThan(0); // Prices should change
      expect(priceRange / minPrice).toBeLessThan(0.1); // But not more than 10% range
    });

    it('should maintain bid-ask spread', async () => {
      const bookTicker = await service.getBookTicker('ILMTUSDT');
      const bid = parseFloat(bookTicker.bidPrice);
      const ask = parseFloat(bookTicker.askPrice);
      const spread = ask - bid;

      expect(spread).toBeGreaterThan(0);
      expect(spread / bid).toBeLessThan(0.01); // Spread should be less than 1%
    });
  });
});
