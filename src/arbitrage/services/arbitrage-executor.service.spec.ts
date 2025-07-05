import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LoggingService } from '../../logging/logging.service';
import { MexcApiService } from '../../mexc/services/mexc-api.service';
import { PancakeSwapService } from '../../pancakeswap/services/pancakeswap.service';
import { BlockchainService } from '../../pancakeswap/services/blockchain.service';
import { ArbitrageExecutorService } from './arbitrage-executor.service';
import {
  ArbitrageOpportunity,
  InsufficientBalanceError,
} from '../types/arbitrage.types';

describe('ArbitrageExecutorService', () => {
  let service: ArbitrageExecutorService;
  let eventEmitter: jest.Mocked<EventEmitter2>;
  let loggingService: jest.Mocked<LoggingService>;
  let mexcApiService: jest.Mocked<MexcApiService>;
  let pancakeSwapService: jest.Mocked<PancakeSwapService>;
  let blockchainService: jest.Mocked<BlockchainService>;

  const mockOpportunity: ArbitrageOpportunity = {
    id: 'test_opportunity_123',
    symbol: 'ILMTUSDT',
    buyExchange: 'MEXC',
    sellExchange: 'PANCAKESWAP',
    buyPrice: 0.05,
    sellPrice: 0.052,
    spread: 0.002,
    spreadPercentage: 4.0,
    estimatedProfit: 4.0,
    estimatedProfitPercentage: 4.0,
    maxTradeSize: 500,
    timestamp: new Date(),
    expiresAt: new Date(Date.now() + 30000),
    mexcFee: 0.002,
    pancakeswapFee: 0.0025,
    gasCost: 0.5,
    totalFees: 0.0045,
    netProfit: 3.5,
    netProfitPercentage: 3.5,
    confidence: 'HIGH',
    riskLevel: 'LOW',
  };

  beforeEach(async () => {
    const mockEventEmitter = {
      emit: jest.fn(),
    };

    const mockLoggingService = {
      info: jest.fn(),
    };

    const mockMexcApiService = {
      placeOrder: jest.fn(),
      getOrder: jest.fn(),
      getAccount: jest.fn(),
    };

    const mockPancakeSwapService = {
      swapExactTokensForTokens: jest.fn(),
      getTokenBalance: jest.fn(),
      getBNBBalance: jest.fn(),
    };

    const mockBlockchainService = {
      // Add any blockchain service methods that might be needed
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArbitrageExecutorService,
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
        {
          provide: BlockchainService,
          useValue: mockBlockchainService,
        },
      ],
    }).compile();

    service = module.get<ArbitrageExecutorService>(ArbitrageExecutorService);
    eventEmitter = module.get(EventEmitter2);
    loggingService = module.get(LoggingService);
    mexcApiService = module.get(MexcApiService);
    pancakeSwapService = module.get(PancakeSwapService);
    blockchainService = module.get(BlockchainService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Balance Validation', () => {
    it('should validate sufficient MEXC USDT balance for buy orders', async () => {
      mexcApiService.getAccount.mockResolvedValue({
        balances: [
          { asset: 'USDT', free: '1000.00', locked: '0.00' },
          { asset: 'ILMT', free: '500.00', locked: '0.00' },
        ],
        canTrade: true,
        makerCommission: 15,
        takerCommission: 15,
        buyerCommission: 0,
        sellerCommission: 0,
        canWithdraw: true,
        canDeposit: true,
        updateTime: Date.now(),
        accountType: 'SPOT',
      });

      pancakeSwapService.getBNBBalance.mockResolvedValue('0.1');

      mexcApiService.placeOrder.mockResolvedValue({
        symbol: 'ILMTUSDT',
        orderId: 123456,
        orderListId: -1,
        clientOrderId: 'test-order-123',
        price: '0.05',
        origQty: '2000',
        executedQty: '2000',
        cummulativeQuoteQty: '100',
        status: 'FILLED',
        timeInForce: 'GTC',
        type: 'MARKET',
        side: 'BUY',
        stopPrice: '0',
        icebergQty: '0',
        time: Date.now(),
        updateTime: Date.now(),
        isWorking: true,
        origQuoteOrderQty: '100',
      });

      mexcApiService.getOrder.mockResolvedValue({
        symbol: 'ILMTUSDT',
        orderId: 123456,
        orderListId: -1,
        clientOrderId: 'test-order-123',
        price: '0.05',
        origQty: '2000',
        executedQty: '2000',
        cummulativeQuoteQty: '100',
        status: 'FILLED',
        timeInForce: 'GTC',
        type: 'MARKET',
        side: 'BUY',
        stopPrice: '0',
        icebergQty: '0',
        time: Date.now(),
        updateTime: Date.now(),
        isWorking: true,
        origQuoteOrderQty: '100',
      });

      pancakeSwapService.swapExactTokensForTokens.mockResolvedValue({
        transactionHash: '0x123abc',
        blockNumber: 12346,
        gasUsed: '180000',
        effectiveGasPrice: '5000000000',
        amountIn: '2000',
        amountOut: '104',
        path: ['0x123', '0x456'],
        timestamp: new Date(),
        success: true,
      });

      const trade = await service.executeArbitrage(mockOpportunity, 100);

      expect(trade.status).toBe('COMPLETED');
      expect(trade.mexcTrade).toBeDefined();
      expect(trade.pancakeswapTrade).toBeDefined();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'trade.started',
        expect.any(Object),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'trade.completed',
        expect.any(Object),
      );
    });

    it('should throw insufficient balance error when MEXC USDT balance is too low', async () => {
      mexcApiService.getAccount.mockResolvedValue({
        balances: [
          { asset: 'USDT', free: '50.00', locked: '0.00' }, // Insufficient
          { asset: 'ILMT', free: '500.00', locked: '0.00' },
        ],
        canTrade: true,
        makerCommission: 15,
        takerCommission: 15,
        buyerCommission: 0,
        sellerCommission: 0,
        canWithdraw: true,
        canDeposit: true,
        updateTime: Date.now(),
        accountType: 'SPOT',
      });

      pancakeSwapService.getBNBBalance.mockResolvedValue('0.1');

      await expect(
        service.executeArbitrage(mockOpportunity, 100),
      ).rejects.toThrow(InsufficientBalanceError);

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'trade.started',
        expect.any(Object),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'trade.failed',
        expect.any(Object),
      );
    });

    it('should throw insufficient balance error when BNB balance is too low', async () => {
      mexcApiService.getAccount.mockResolvedValue({
        balances: [
          { asset: 'USDT', free: '1000.00', locked: '0.00' },
          { asset: 'ILMT', free: '500.00', locked: '0.00' },
        ],
        canTrade: true,
        makerCommission: 15,
        takerCommission: 15,
        buyerCommission: 0,
        sellerCommission: 0,
        canWithdraw: true,
        canDeposit: true,
        updateTime: Date.now(),
        accountType: 'SPOT',
      });

      pancakeSwapService.getBNBBalance.mockResolvedValue('0.005'); // Insufficient for gas

      await expect(
        service.executeArbitrage(mockOpportunity, 100),
      ).rejects.toThrow(InsufficientBalanceError);
    });
  });

  describe('MEXC to PancakeSwap Execution', () => {
    beforeEach(() => {
      mexcApiService.getAccount.mockResolvedValue({
        balances: [
          { asset: 'USDT', free: '1000.00', locked: '0.00' },
          { asset: 'ILMT', free: '500.00', locked: '0.00' },
        ],
        canTrade: true,
        makerCommission: 15,
        takerCommission: 15,
        buyerCommission: 0,
        sellerCommission: 0,
        canWithdraw: true,
        canDeposit: true,
        updateTime: Date.now(),
        accountType: 'SPOT',
      });

      pancakeSwapService.getBNBBalance.mockResolvedValue('0.1');
    });

    it('should execute MEXC to PancakeSwap arbitrage successfully', async () => {
      mexcApiService.placeOrder.mockResolvedValue({
        symbol: 'ILMTUSDT',
        orderId: 123456,
        orderListId: -1,
        clientOrderId: 'test-order-123',
        price: '0.05',
        origQty: '2000',
        executedQty: '2000',
        cummulativeQuoteQty: '100',
        status: 'FILLED',
        timeInForce: 'GTC',
        type: 'MARKET',
        side: 'BUY',
        stopPrice: '0',
        icebergQty: '0',
        time: Date.now(),
        updateTime: Date.now(),
        isWorking: true,
        origQuoteOrderQty: '100',
      });

      mexcApiService.getOrder.mockResolvedValue({
        symbol: 'ILMTUSDT',
        orderId: 123456,
        orderListId: -1,
        clientOrderId: 'test-order-123',
        price: '0.05',
        origQty: '2000',
        executedQty: '2000',
        cummulativeQuoteQty: '100',
        status: 'FILLED',
        timeInForce: 'GTC',
        type: 'MARKET',
        side: 'BUY',
        stopPrice: '0',
        icebergQty: '0',
        time: Date.now(),
        updateTime: Date.now(),
        isWorking: true,
        origQuoteOrderQty: '100',
      });

      pancakeSwapService.swapExactTokensForTokens.mockResolvedValue({
        transactionHash: '0x123abc',
        blockNumber: 12346,
        gasUsed: '180000',
        effectiveGasPrice: '5000000000',
        amountIn: '2000',
        amountOut: '104',
        path: ['0x123', '0x456'],
        timestamp: new Date(),
        success: true,
      });

      const trade = await service.executeArbitrage(mockOpportunity, 100);

      expect(trade.status).toBe('COMPLETED');
      expect(trade.mexcTrade?.side).toBe('BUY');
      expect(trade.pancakeswapTrade?.side).toBe('SELL');
      expect(trade.executionTime).toBeGreaterThanOrEqual(0);
      expect(trade.netProfit).toBeDefined();

      expect(loggingService.info).toHaveBeenCalledWith(
        'Starting arbitrage execution',
        expect.objectContaining({
          component: 'ArbitrageExecutorService',
          tradeId: expect.any(String),
          direction: 'MEXC -> PANCAKESWAP',
        }),
      );

      expect(loggingService.info).toHaveBeenCalledWith(
        'Arbitrage execution completed',
        expect.objectContaining({
          component: 'ArbitrageExecutorService',
          tradeId: expect.any(String),
          executionTime: expect.any(Number),
        }),
      );
    });

    it('should handle MEXC order failures', async () => {
      mexcApiService.placeOrder.mockRejectedValue(
        new Error('Order placement failed'),
      );

      await expect(
        service.executeArbitrage(mockOpportunity, 100),
      ).rejects.toThrow('Order placement failed');

      const activeTrades = service.getActiveTrades();
      const failedTrade = activeTrades.find((t) => t.status === 'FAILED');
      expect(failedTrade).toBeDefined();
      expect(failedTrade?.error).toBe('Order placement failed');
    });

    it('should handle PancakeSwap transaction failures', async () => {
      mexcApiService.placeOrder.mockResolvedValue({
        symbol: 'ILMTUSDT',
        orderId: 123456,
        orderListId: -1,
        clientOrderId: 'test-order-123',
        price: '0.05',
        origQty: '2000',
        executedQty: '2000',
        cummulativeQuoteQty: '100',
        status: 'FILLED',
        timeInForce: 'GTC',
        type: 'MARKET',
        side: 'BUY',
        stopPrice: '0',
        icebergQty: '0',
        time: Date.now(),
        updateTime: Date.now(),
        isWorking: true,
        origQuoteOrderQty: '100',
      });

      mexcApiService.getOrder.mockResolvedValue({
        symbol: 'ILMTUSDT',
        orderId: 123456,
        orderListId: -1,
        clientOrderId: 'test-order-123',
        price: '0.05',
        origQty: '2000',
        executedQty: '2000',
        cummulativeQuoteQty: '100',
        status: 'FILLED',
        timeInForce: 'GTC',
        type: 'MARKET',
        side: 'BUY',
        stopPrice: '0',
        icebergQty: '0',
        time: Date.now(),
        updateTime: Date.now(),
        isWorking: true,
        origQuoteOrderQty: '100',
      });

      pancakeSwapService.swapExactTokensForTokens.mockResolvedValue({
        transactionHash: '0x123abc',
        blockNumber: 12346,
        gasUsed: '180000',
        effectiveGasPrice: '5000000000',
        amountIn: '2000',
        amountOut: '104',
        path: ['0x123', '0x456'],
        timestamp: new Date(),
        success: false, // Transaction failed
      });

      await expect(
        service.executeArbitrage(mockOpportunity, 100),
      ).rejects.toThrow('PancakeSwap transaction failed');
    });
  });

  describe('PancakeSwap to MEXC Execution', () => {
    const reversedOpportunity: ArbitrageOpportunity = {
      ...mockOpportunity,
      buyExchange: 'PANCAKESWAP',
      sellExchange: 'MEXC',
    };

    beforeEach(() => {
      pancakeSwapService.getTokenBalance.mockResolvedValue('1000');
      pancakeSwapService.getBNBBalance.mockResolvedValue('0.1');
    });

    it('should execute PancakeSwap to MEXC arbitrage successfully', async () => {
      pancakeSwapService.swapExactTokensForTokens.mockResolvedValue({
        transactionHash: '0x123abc',
        blockNumber: 12346,
        gasUsed: '180000',
        effectiveGasPrice: '5000000000',
        amountIn: '100',
        amountOut: '2000',
        path: ['0x456', '0x123'],
        timestamp: new Date(),
        success: true,
      });

      mexcApiService.placeOrder.mockResolvedValue({
        symbol: 'ILMTUSDT',
        orderId: 123456,
        orderListId: -1,
        clientOrderId: 'test-order-123',
        price: '0.052',
        origQty: '2000',
        executedQty: '2000',
        cummulativeQuoteQty: '104',
        status: 'FILLED',
        timeInForce: 'GTC',
        type: 'MARKET',
        side: 'SELL',
        stopPrice: '0',
        icebergQty: '0',
        time: Date.now(),
        updateTime: Date.now(),
        isWorking: true,
        origQuoteOrderQty: '104',
      });

      mexcApiService.getOrder.mockResolvedValue({
        symbol: 'ILMTUSDT',
        orderId: 123456,
        orderListId: -1,
        clientOrderId: 'test-order-123',
        price: '0.052',
        origQty: '2000',
        executedQty: '2000',
        cummulativeQuoteQty: '104',
        status: 'FILLED',
        timeInForce: 'GTC',
        type: 'MARKET',
        side: 'SELL',
        stopPrice: '0',
        icebergQty: '0',
        time: Date.now(),
        updateTime: Date.now(),
        isWorking: true,
        origQuoteOrderQty: '100',
      });

      const trade = await service.executeArbitrage(reversedOpportunity, 100);

      expect(trade.status).toBe('COMPLETED');
      expect(trade.pancakeswapTrade?.side).toBe('BUY');
      expect(trade.mexcTrade?.side).toBe('SELL');
    });
  });

  describe('Trade Management', () => {
    it('should track active trades', () => {
      const activeTrades = service.getActiveTrades();
      expect(Array.isArray(activeTrades)).toBe(true);
    });

    it('should retrieve specific trade by ID', async () => {
      mexcApiService.getAccount.mockResolvedValue({
        balances: [
          { asset: 'USDT', free: '1000.00', locked: '0.00' },
          { asset: 'ILMT', free: '500.00', locked: '0.00' },
        ],
        canTrade: true,
        makerCommission: 15,
        takerCommission: 15,
        buyerCommission: 0,
        sellerCommission: 0,
        canWithdraw: true,
        canDeposit: true,
        updateTime: Date.now(),
        accountType: 'SPOT',
      });

      pancakeSwapService.getBNBBalance.mockResolvedValue('0.1');

      // Mock successful execution
      mexcApiService.placeOrder.mockResolvedValue({
        symbol: 'ILMTUSDT',
        orderId: 123456,
        orderListId: -1,
        clientOrderId: 'test-order-123',
        price: '0.05',
        origQty: '2000',
        executedQty: '2000',
        cummulativeQuoteQty: '100',
        status: 'FILLED',
        timeInForce: 'GTC',
        type: 'MARKET',
        side: 'BUY',
        stopPrice: '0',
        icebergQty: '0',
        time: Date.now(),
        updateTime: Date.now(),
        isWorking: true,
        origQuoteOrderQty: '100',
      });

      mexcApiService.getOrder.mockResolvedValue({
        symbol: 'ILMTUSDT',
        orderId: 123456,
        orderListId: -1,
        clientOrderId: 'test-order-123',
        price: '0.05',
        origQty: '2000',
        executedQty: '2000',
        cummulativeQuoteQty: '100',
        status: 'FILLED',
        timeInForce: 'GTC',
        type: 'MARKET',
        side: 'BUY',
        stopPrice: '0',
        icebergQty: '0',
        time: Date.now(),
        updateTime: Date.now(),
        isWorking: true,
        origQuoteOrderQty: '100',
      });

      pancakeSwapService.swapExactTokensForTokens.mockResolvedValue({
        transactionHash: '0x123abc',
        blockNumber: 12346,
        gasUsed: '180000',
        effectiveGasPrice: '5000000000',
        amountIn: '2000',
        amountOut: '104',
        path: ['0x123', '0x456'],
        timestamp: new Date(),
        success: true,
      });

      const trade = await service.executeArbitrage(mockOpportunity, 100);
      const retrievedTrade = service.getTrade(trade.id);

      expect(retrievedTrade).toEqual(trade);
    });

    it('should provide execution metrics', () => {
      const metrics = service.getExecutionMetrics();

      expect(metrics).toHaveProperty('activeTrades');
      expect(metrics).toHaveProperty('queuedOpportunities');
      expect(metrics).toHaveProperty('isExecuting');
      expect(typeof metrics.activeTrades).toBe('number');
      expect(typeof metrics.queuedOpportunities).toBe('number');
      expect(typeof metrics.isExecuting).toBe('boolean');
    });

    it('should clear completed trades', () => {
      service.clearCompletedTrades();

      expect(loggingService.info).toHaveBeenCalledWith(
        'Cleared completed trades',
        expect.objectContaining({
          component: 'ArbitrageExecutorService',
          clearedCount: expect.any(Number),
        }),
      );
    });
  });
});
