import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LoggingService } from '../../logging/logging.service';
import {
  MexcTicker,
  MexcAccount,
  MexcOrder,
  MexcOrderRequest,
  MexcTrade,
  MexcPriceUpdateEvent,
  MexcTradeEvent,
} from '../types/mexc.types';

/**
 * Mock MEXC service for testing and development
 * Simulates MEXC API behavior without actual network calls
 */
@Injectable()
export class MexcMockService {
  private mockOrders = new Map<number, MexcOrder>();
  private orderIdCounter = 100000;
  private mockBalances: { [asset: string]: { free: number; locked: number } } =
    {
      USDT: { free: 10000, locked: 0 },
      ILMT: { free: 200000, locked: 0 },
      BNB: { free: 1, locked: 0 },
    };

  // Mock price data with realistic fluctuations
  private basePrices: { [symbol: string]: number } = {
    ILMTUSDT: 0.05,
    BNBUSDT: 250,
    BTCUSDT: 45000,
  };

  private priceUpdateInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private readonly loggingService: LoggingService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // Mock API Methods

  async ping(): Promise<boolean> {
    await this.delay(50); // Simulate network latency
    return true;
  }

  async getServerTime(): Promise<number> {
    await this.delay(30);
    return Date.now();
  }

  async getTicker(symbol: string): Promise<MexcTicker> {
    await this.delay(100);

    const basePrice = this.basePrices[symbol] || 1;
    const price = this.simulatePrice(basePrice);
    const priceChange = (Math.random() - 0.5) * 0.02 * basePrice; // ±2% change

    return {
      symbol,
      price: price.toFixed(8), // Add the price field that MEXC actually returns
      priceChange: priceChange.toFixed(8),
      priceChangePercent: ((priceChange / basePrice) * 100).toFixed(2),
      weightedAvgPrice: price.toFixed(8),
      prevClosePrice: (basePrice - priceChange).toFixed(8),
      lastPrice: price.toFixed(8),
      lastQty: (Math.random() * 1000 + 10).toFixed(8),
      bidPrice: (price * 0.999).toFixed(8),
      bidQty: (Math.random() * 5000 + 100).toFixed(8),
      askPrice: (price * 1.001).toFixed(8),
      askQty: (Math.random() * 5000 + 100).toFixed(8),
      openPrice: basePrice.toFixed(8),
      highPrice: (price * 1.02).toFixed(8),
      lowPrice: (price * 0.98).toFixed(8),
      volume: (Math.random() * 1000000 + 100000).toFixed(8),
      quoteVolume: (Math.random() * 50000 + 5000).toFixed(8),
      openTime: Date.now() - 24 * 60 * 60 * 1000,
      closeTime: Date.now(),
      count: Math.floor(Math.random() * 10000) + 1000,
    };
  }

  async getBookTicker(symbol: string): Promise<{
    bidPrice: string;
    bidQty: string;
    askPrice: string;
    askQty: string;
  }> {
    await this.delay(80);

    const basePrice = this.basePrices[symbol] || 1;
    const price = this.simulatePrice(basePrice);

    return {
      bidPrice: (price * 0.999).toFixed(8),
      bidQty: (Math.random() * 5000 + 100).toFixed(8),
      askPrice: (price * 1.001).toFixed(8),
      askQty: (Math.random() * 5000 + 100).toFixed(8),
    };
  }

  async getAccount(): Promise<MexcAccount> {
    await this.delay(150);

    const balances = Object.entries(this.mockBalances).map(
      ([asset, balance]) => ({
        asset,
        free: balance.free.toString(),
        locked: balance.locked.toString(),
      }),
    );

    return {
      makerCommission: 15,
      takerCommission: 15,
      buyerCommission: 0,
      sellerCommission: 0,
      canTrade: true,
      canWithdraw: true,
      canDeposit: true,
      updateTime: Date.now(),
      accountType: 'SPOT',
      balances,
    };
  }

  async placeOrder(orderRequest: MexcOrderRequest): Promise<MexcOrder> {
    await this.delay(200);

    const orderId = this.orderIdCounter++;
    const ticker = await this.getTicker(orderRequest.symbol);
    const currentPrice = parseFloat(ticker.price || ticker.lastPrice || '0');

    // Simulate order execution
    const executedQty =
      orderRequest.type === 'MARKET' ? orderRequest.quantity || '0' : '0';
    const price = orderRequest.price || currentPrice.toString();

    const order: MexcOrder = {
      symbol: orderRequest.symbol,
      orderId,
      orderListId: -1,
      clientOrderId: orderRequest.newClientOrderId || `mock_order_${orderId}`,
      price,
      origQty: orderRequest.quantity || '0',
      executedQty,
      cummulativeQuoteQty: (
        parseFloat(executedQty) * parseFloat(price)
      ).toString(),
      status: orderRequest.type === 'MARKET' ? 'FILLED' : 'NEW',
      timeInForce: orderRequest.timeInForce || 'GTC',
      type: orderRequest.type,
      side: orderRequest.side,
      stopPrice: orderRequest.stopPrice || '0',
      icebergQty: orderRequest.icebergQty || '0',
      time: Date.now(),
      updateTime: Date.now(),
      isWorking: orderRequest.type !== 'MARKET',
      origQuoteOrderQty: orderRequest.quoteOrderQty || '0',
    };

    this.mockOrders.set(orderId, order);

    // Update mock balances for market orders
    if (orderRequest.type === 'MARKET' && orderRequest.quantity) {
      this.updateBalancesAfterTrade(orderRequest, parseFloat(price));
    }

    this.loggingService.info(`Mock order placed`, {
      component: 'MexcMockService',
      operation: 'PLACE_ORDER',
      orderId,
      symbol: orderRequest.symbol,
      side: orderRequest.side,
      type: orderRequest.type,
    });

    return order;
  }

  async cancelOrder(symbol: string, orderId: number): Promise<MexcOrder> {
    await this.delay(120);

    const order = this.mockOrders.get(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    const cancelledOrder = {
      ...order,
      status: 'CANCELED' as const,
      updateTime: Date.now(),
    };

    this.mockOrders.set(orderId, cancelledOrder);

    this.loggingService.info(`Mock order cancelled`, {
      component: 'MexcMockService',
      operation: 'CANCEL_ORDER',
      orderId,
      symbol,
    });

    return cancelledOrder;
  }

  async getOrder(symbol: string, orderId: number): Promise<MexcOrder> {
    await this.delay(100);

    const order = this.mockOrders.get(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    return order;
  }

  async getMyTrades(symbol: string, limit = 500): Promise<MexcTrade[]> {
    await this.delay(150);

    const trades: MexcTrade[] = [];
    const basePrice = this.basePrices[symbol] || 1;

    // Generate some mock trades
    for (let i = 0; i < Math.min(10, limit); i++) {
      const price = this.simulatePrice(basePrice);
      const qty = Math.random() * 100 + 10;

      trades.push({
        symbol,
        id: 100000 + i,
        orderId: 200000 + i,
        orderListId: -1,
        price: price.toFixed(8),
        qty: qty.toFixed(8),
        quoteQty: (price * qty).toFixed(8),
        commission: (price * qty * 0.0015).toFixed(8), // 0.15% commission
        commissionAsset: 'USDT',
        time: Date.now() - i * 60000, // 1 minute apart
        isBuyer: Math.random() > 0.5,
        isMaker: Math.random() > 0.5,
        isBestMatch: true,
      });
    }

    return trades;
  }

  // Mock WebSocket functionality

  startMockPriceUpdates(symbols: string[] = ['ILMTUSDT']): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.priceUpdateInterval = setInterval(() => {
      symbols.forEach((symbol) => {
        this.emitMockPriceUpdate(symbol);
      });
    }, 2000); // Update every 2 seconds

    this.loggingService.info('Mock price updates started', {
      component: 'MexcMockService',
      operation: 'START_PRICE_UPDATES',
      symbols,
    });
  }

  stopMockPriceUpdates(): void {
    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
      this.priceUpdateInterval = null;
    }

    this.isRunning = false;

    this.loggingService.info('Mock price updates stopped', {
      component: 'MexcMockService',
      operation: 'STOP_PRICE_UPDATES',
    });
  }

  simulateTrade(symbol: string): void {
    const basePrice = this.basePrices[symbol] || 1;
    const price = this.simulatePrice(basePrice);
    const quantity = Math.random() * 1000 + 10;

    const tradeEvent: MexcTradeEvent = {
      symbol,
      tradeId: Math.floor(Math.random() * 1000000),
      price,
      quantity,
      timestamp: new Date(),
      isBuyerMaker: Math.random() > 0.5,
    };

    this.eventEmitter.emit('mexc.trade.executed', tradeEvent);
  }

  // Helper Methods

  private emitMockPriceUpdate(symbol: string): void {
    const basePrice = this.basePrices[symbol] || 1;
    const price = this.simulatePrice(basePrice);
    const bid = price * (0.999 + Math.random() * 0.001);
    const ask = price * (1.001 - Math.random() * 0.001);

    const priceEvent: MexcPriceUpdateEvent = {
      symbol,
      price,
      bid,
      ask,
      timestamp: new Date(),
      source: 'WS',
    };

    this.eventEmitter.emit('mexc.price.update', priceEvent);
  }

  private simulatePrice(basePrice: number): number {
    // Simulate realistic price movements
    const volatility = 0.001; // 0.1% volatility
    const change = (Math.random() - 0.5) * 2 * volatility;
    const newPrice = basePrice * (1 + change);

    // Update base price slightly for next simulation
    this.basePrices[
      Object.keys(this.basePrices).find(
        (k) => this.basePrices[k] === basePrice,
      ) || 'ILMTUSDT'
    ] = newPrice;

    return newPrice;
  }

  private updateBalancesAfterTrade(
    orderRequest: MexcOrderRequest,
    price: number,
  ): void {
    const quantity = parseFloat(orderRequest.quantity || '0');
    const symbol = orderRequest.symbol;

    // Extract base and quote assets from symbol (e.g., ILMTUSDT -> ILMT, USDT)
    const baseAsset = symbol
      .replace('USDT', '')
      .replace('BTC', '')
      .replace('BNB', '');
    const quoteAsset = symbol.includes('USDT') ? 'USDT' : 'BTC';

    if (!this.mockBalances[baseAsset]) {
      this.mockBalances[baseAsset] = { free: 1000000, locked: 0 };
    }

    if (!this.mockBalances[quoteAsset]) {
      this.mockBalances[quoteAsset] = { free: 10000, locked: 0 };
    }

    if (orderRequest.side === 'BUY') {
      // Buying base asset with quote asset
      const cost = quantity * price;
      this.mockBalances[quoteAsset].free -= cost;
      this.mockBalances[baseAsset].free += quantity;
    } else {
      // Selling base asset for quote asset
      const proceeds = quantity * price;
      this.mockBalances[baseAsset].free -= quantity;
      this.mockBalances[quoteAsset].free += proceeds;
    }

    // Apply trading fee (0.15% in quote asset)
    const fee = quantity * price * 0.0015;
    this.mockBalances[quoteAsset].free -= fee;
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Getters for testing

  getMockBalances(): { [asset: string]: { free: number; locked: number } } {
    return { ...this.mockBalances };
  }

  getMockOrders(): Map<number, MexcOrder> {
    return new Map(this.mockOrders);
  }

  setMockPrice(symbol: string, price: number): void {
    this.basePrices[symbol] = price;
  }

  resetMockData(): void {
    this.mockOrders.clear();
    this.orderIdCounter = 100000;
    this.mockBalances = {
      USDT: { free: 10000, locked: 0 },
      ILMT: { free: 200000, locked: 0 },
      BNB: { free: 1, locked: 0 },
    };
    this.basePrices = {
      ILMTUSDT: 0.05,
      BNBUSDT: 250,
      BTCUSDT: 45000,
    };
  }

  isUpdatesRunning(): boolean {
    return this.isRunning;
  }
}
