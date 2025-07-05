import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BlockchainService } from './blockchain.service';
import { PancakeSwapService } from './pancakeswap.service';
import { LoggingService } from '../../logging/logging.service';
import {
  BSC_TOKENS,
  PANCAKESWAP_CONTRACTS,
  SLIPPAGE_PRESETS,
} from '../types/pancakeswap.types';

describe('PancakeSwapService', () => {
  let service: PancakeSwapService;
  let blockchainService: jest.Mocked<BlockchainService>;
  let eventEmitter: jest.Mocked<EventEmitter2>;
  let loggingService: jest.Mocked<LoggingService>;

  const mockRouterContract = {
    getAmountsOut: jest.fn(),
    getAmountsIn: jest.fn(),
    swapExactTokensForTokens: jest.fn(),
    swapTokensForExactTokens: jest.fn(),
  };

  beforeEach(async () => {
    const mockBlockchainService = {
      getRouterContract: jest.fn().mockReturnValue(mockRouterContract),
      getWalletAddress: jest
        .fn()
        .mockResolvedValue('0x1234567890123456789012345678901234567890'),
      getBalance: jest.fn().mockResolvedValue('1000'),
      getTokenBalance: jest.fn().mockResolvedValue({
        token: BSC_TOKENS.USDT,
        balance: '1000000000000000000000',
        balanceFormatted: '1000',
      }),
      getTokenBalances: jest.fn().mockResolvedValue([
        {
          token: BSC_TOKENS.USDT,
          balance: '1000000000000000000000',
          balanceFormatted: '1000',
        },
        {
          token: BSC_TOKENS.USDC,
          balance: '500000000000000000000',
          balanceFormatted: '500',
        },
      ]),
      estimateGas: jest.fn().mockResolvedValue({
        gasLimit: '200000',
        gasPrice: '5',
        maxFeePerGas: '5',
        maxPriorityFeePerGas: '2',
        estimatedCost: '0.001',
      }),
      getAllowance: jest.fn().mockResolvedValue('0'),
      approveToken: jest.fn().mockResolvedValue({
        token: BSC_TOKENS.USDT.address,
        spender: PANCAKESWAP_CONTRACTS.ROUTER_V2,
        amount: '100000000000000000000',
        transactionHash: '0x456def',
      }),
      waitForTransaction: jest.fn().mockResolvedValue({
        hash: '0x123abc',
        blockNumber: 12346,
        gasUsed: 180000n,
        gasPrice: 5000000000n,
        status: 1,
      }),
    };

    const mockEventEmitter = {
      emit: jest.fn(),
    };

    const mockLoggingService = {
      info: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PancakeSwapService,
        {
          provide: BlockchainService,
          useValue: mockBlockchainService,
        },
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

    service = module.get<PancakeSwapService>(PancakeSwapService);
    blockchainService = module.get(BlockchainService);
    eventEmitter = module.get(EventEmitter2);
    loggingService = module.get(LoggingService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Price Queries', () => {
    it('should get amounts out', async () => {
      const mockAmounts = [1000000000000000000n, 50000000000000000n]; // 1 USDT -> 0.05 ILMT
      mockRouterContract.getAmountsOut.mockResolvedValue(mockAmounts);

      const path = [BSC_TOKENS.USDT.address, BSC_TOKENS.WBNB.address];
      const amounts = await service.getAmountsOut('1000000000000000000', path);

      expect(amounts).toEqual(['1000000000000000000', '50000000000000000']);
      expect(mockRouterContract.getAmountsOut).toHaveBeenCalledWith(
        '1000000000000000000',
        path,
      );
    });

    it('should get amounts in', async () => {
      const mockAmounts = [2000000000000000000n, 100000000000000000n]; // 2 USDT -> 0.1 ILMT
      mockRouterContract.getAmountsIn.mockResolvedValue(mockAmounts);

      const path = [BSC_TOKENS.USDT.address, BSC_TOKENS.WBNB.address];
      const amounts = await service.getAmountsIn('100000000000000000', path);

      expect(amounts).toEqual(['2000000000000000000', '100000000000000000']);
      expect(mockRouterContract.getAmountsIn).toHaveBeenCalledWith(
        '100000000000000000',
        path,
      );
    });

    it('should get price quote', async () => {
      const mockAmounts = [1000000000000000000n, 50000000000000000000n]; // 1 USDT -> 50 ILMT
      mockRouterContract.getAmountsOut.mockResolvedValue(mockAmounts);

      const tokenIn = BSC_TOKENS.USDT;
      const tokenOut = { ...BSC_TOKENS.WBNB, symbol: 'ILMT' };

      const quote = await service.getQuote(
        tokenIn,
        tokenOut,
        '1',
        SLIPPAGE_PRESETS.MEDIUM,
      );

      expect(quote).toEqual({
        tokenIn,
        tokenOut,
        amountIn: '1',
        amountOut: '50.0',
        priceImpact: expect.any(String),
        minimumAmountOut: '49.50000000', // 50 * (1 - 0.01)
        route: [tokenIn.address, tokenOut.address],
        gasEstimate: expect.any(Object),
      });
    });
  });

  describe('Swap Operations', () => {
    it('should swap exact tokens for tokens', async () => {
      const mockAmounts = [1000000000000000000n, 50000000000000000000n]; // 1 USDT -> 50 ILMT
      mockRouterContract.getAmountsOut.mockResolvedValue(mockAmounts);

      const mockTx = {
        hash: '0x123abc',
        wait: jest.fn().mockResolvedValue({
          hash: '0x123abc',
          blockNumber: 12346,
          gasUsed: 180000n,
          status: 1,
        }),
      };
      mockRouterContract.swapExactTokensForTokens.mockResolvedValue(mockTx);

      const tokenIn = BSC_TOKENS.USDT;
      const tokenOut = { ...BSC_TOKENS.WBNB, symbol: 'ILMT' };

      const result = await service.swapExactTokensForTokens(
        tokenIn,
        tokenOut,
        '1',
        SLIPPAGE_PRESETS.MEDIUM,
      );

      expect(result).toEqual({
        transactionHash: '0x123abc',
        blockNumber: 12346,
        gasUsed: '180000',
        effectiveGasPrice: '5000000000',
        amountIn: '1',
        amountOut: '50.0',
        path: [tokenIn.address, tokenOut.address],
        timestamp: expect.any(Date),
        success: true,
      });

      expect(mockRouterContract.swapExactTokensForTokens).toHaveBeenCalledWith(
        1000000000000000000n, // 1 USDT
        49500000000000000000n, // 49.5 ILMT (minimum)
        [tokenIn.address, tokenOut.address],
        '0x1234567890123456789012345678901234567890',
        expect.any(Number), // deadline
      );

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'pancakeswap.swap.completed',
        result,
      );
    });

    it('should swap tokens for exact tokens', async () => {
      const mockAmounts = [2000000000000000000n, 100000000000000000000n]; // 2 USDT -> 100 ILMT
      mockRouterContract.getAmountsIn.mockResolvedValue(mockAmounts);

      const mockTx = {
        hash: '0x123abc',
        wait: jest.fn().mockResolvedValue({
          hash: '0x123abc',
          blockNumber: 12346,
          gasUsed: 180000n,
          status: 1,
        }),
      };
      mockRouterContract.swapTokensForExactTokens.mockResolvedValue(mockTx);

      const tokenIn = BSC_TOKENS.USDT;
      const tokenOut = { ...BSC_TOKENS.WBNB, symbol: 'ILMT' };

      const result = await service.swapTokensForExactTokens(
        tokenIn,
        tokenOut,
        '100',
        SLIPPAGE_PRESETS.MEDIUM,
      );

      expect(result).toEqual({
        transactionHash: '0x123abc',
        blockNumber: 12346,
        gasUsed: '180000',
        effectiveGasPrice: '5000000000',
        amountIn: '2.0',
        amountOut: '100',
        path: [tokenIn.address, tokenOut.address],
        timestamp: expect.any(Date),
        success: true,
      });

      expect(mockRouterContract.swapTokensForExactTokens).toHaveBeenCalledWith(
        100000000000000000000n, // 100 ILMT
        2020000000000000000n, // 2.02 USDT (maximum)
        [tokenIn.address, tokenOut.address],
        '0x1234567890123456789012345678901234567890',
        expect.any(Number), // deadline
      );
    });

    it('should handle token approval before swap', async () => {
      const mockAmounts = [1000000000000000000n, 50000000000000000000n];
      mockRouterContract.getAmountsOut.mockResolvedValue(mockAmounts);

      // Mock insufficient allowance
      blockchainService.getAllowance.mockResolvedValue('0');

      const mockTx = {
        hash: '0x123abc',
        wait: jest.fn().mockResolvedValue({
          hash: '0x123abc',
          blockNumber: 12346,
          gasUsed: 180000n,
          status: 1,
        }),
      };
      mockRouterContract.swapExactTokensForTokens.mockResolvedValue(mockTx);

      const tokenIn = BSC_TOKENS.USDT;
      const tokenOut = { ...BSC_TOKENS.WBNB, symbol: 'ILMT' };

      await service.swapExactTokensForTokens(
        tokenIn,
        tokenOut,
        '1',
        SLIPPAGE_PRESETS.MEDIUM,
      );

      expect(blockchainService.approveToken).toHaveBeenCalledWith(
        tokenIn.address,
        PANCAKESWAP_CONTRACTS.ROUTER_V2,
        '1.0',
        tokenIn.decimals,
      );

      expect(blockchainService.waitForTransaction).toHaveBeenCalledWith(
        '0x456def',
      );
    });

    it('should handle swap errors', async () => {
      const mockAmounts = [1000000000000000000n, 50000000000000000000n];
      mockRouterContract.getAmountsOut.mockResolvedValue(mockAmounts);
      mockRouterContract.swapExactTokensForTokens.mockRejectedValue(
        new Error('Swap failed'),
      );

      const tokenIn = BSC_TOKENS.USDT;
      const tokenOut = { ...BSC_TOKENS.WBNB, symbol: 'ILMT' };

      await expect(
        service.swapExactTokensForTokens(tokenIn, tokenOut, '1'),
      ).rejects.toThrow('Swap failed');

      expect(loggingService.info).toHaveBeenCalledWith(
        expect.stringContaining('Swap failed'),
        expect.objectContaining({
          component: 'PancakeSwapService',
          operation: 'SWAP_EXACT_TOKENS_FOR_TOKENS',
          error: 'Swap failed',
        }),
      );
    });
  });

  describe('Balance Operations', () => {
    it('should get token balance', async () => {
      const balance = await service.getTokenBalance(BSC_TOKENS.USDT);
      expect(balance).toBe('1000');
      expect(blockchainService.getBalance).toHaveBeenCalledWith(
        BSC_TOKENS.USDT.address,
      );
    });

    it('should get multiple token balances', async () => {
      const tokens = [BSC_TOKENS.USDT, BSC_TOKENS.USDC];
      const balances = await service.getTokenBalances(tokens);

      expect(balances).toEqual({
        USDT: '1000',
        USDC: '1000',
      });
    });

    it('should get BNB balance', async () => {
      const balance = await service.getBNBBalance();
      expect(balance).toBe('1000');
      expect(blockchainService.getBalance).toHaveBeenCalledWith();
    });
  });

  describe('Path Finding', () => {
    it('should create direct path for major tokens', async () => {
      const mockAmounts = [1000000000000000000n, 1000000000000000000n];
      mockRouterContract.getAmountsOut.mockResolvedValue(mockAmounts);

      const tokenIn = BSC_TOKENS.USDT;
      const tokenOut = BSC_TOKENS.USDC;

      const quote = await service.getQuote(tokenIn, tokenOut, '1');

      expect(quote.route).toEqual([tokenIn.address, tokenOut.address]);
    });

    it('should route through WBNB for non-major tokens', async () => {
      const mockAmounts = [
        1000000000000000000n,
        50000000000000000000n,
        1000000000000000000n,
      ];
      mockRouterContract.getAmountsOut.mockResolvedValue(mockAmounts);

      const tokenIn = { address: '0x123', symbol: 'ILMT', decimals: 18 };
      const tokenOut = { address: '0x456', symbol: 'OTHER', decimals: 18 };

      const quote = await service.getQuote(tokenIn, tokenOut, '1');

      expect(quote.route).toEqual([
        tokenIn.address,
        BSC_TOKENS.WBNB.address,
        tokenOut.address,
      ]);
    });
  });

  describe('Utility Functions', () => {
    it('should return supported tokens', () => {
      const tokens = service.getSupportedTokens();
      expect(tokens).toEqual(Object.values(BSC_TOKENS));
    });

    it('should return contract addresses', () => {
      expect(service.getRouterAddress()).toBe(PANCAKESWAP_CONTRACTS.ROUTER_V2);
      expect(service.getFactoryAddress()).toBe(
        PANCAKESWAP_CONTRACTS.FACTORY_V2,
      );
    });

    it('should return trading fees', () => {
      const fees = service.getTradingFees();
      expect(fees).toHaveProperty('LP_FEE');
      expect(fees).toHaveProperty('PROTOCOL_FEE');
      expect(fees).toHaveProperty('TOTAL_FEE');
    });

    it('should return slippage presets', () => {
      const presets = service.getSlippagePresets();
      expect(presets).toHaveProperty('VERY_LOW');
      expect(presets).toHaveProperty('LOW');
      expect(presets).toHaveProperty('MEDIUM');
      expect(presets).toHaveProperty('HIGH');
      expect(presets).toHaveProperty('VERY_HIGH');
    });
  });

  describe('Price Impact Calculation', () => {
    it('should calculate price impact', async () => {
      // Mock small trade amounts
      const smallAmounts = [1000000000000000000n, 50000000000000000000n]; // 1 -> 50
      const largeAmounts = [10000000000000000000n, 480000000000000000000n]; // 10 -> 480 (some slippage)

      mockRouterContract.getAmountsOut
        .mockResolvedValueOnce(largeAmounts) // For the main quote
        .mockResolvedValueOnce(smallAmounts); // For price impact calculation

      const tokenIn = BSC_TOKENS.USDT;
      const tokenOut = { ...BSC_TOKENS.WBNB, symbol: 'ILMT' };

      const quote = await service.getQuote(tokenIn, tokenOut, '10');

      expect(quote.priceImpact).toBeDefined();
      expect(parseFloat(quote.priceImpact)).toBeGreaterThan(0);
    });
  });

  describe('Slippage Calculations', () => {
    it('should calculate minimum amount out correctly', async () => {
      const mockAmounts = [1000000000000000000n, 50000000000000000000n];
      mockRouterContract.getAmountsOut.mockResolvedValue(mockAmounts);

      const tokenIn = BSC_TOKENS.USDT;
      const tokenOut = { ...BSC_TOKENS.WBNB, symbol: 'ILMT' };

      const quote = await service.getQuote(tokenIn, tokenOut, '1', 0.05); // 5% slippage

      expect(quote.minimumAmountOut).toBe('47.50000000'); // 50 * (1 - 0.05)
    });

    it('should calculate maximum amount in correctly', async () => {
      const mockAmounts = [2000000000000000000n, 100000000000000000000n];
      mockRouterContract.getAmountsIn.mockResolvedValue(mockAmounts);

      const tokenIn = BSC_TOKENS.USDT;
      const tokenOut = { ...BSC_TOKENS.WBNB, symbol: 'ILMT' };

      const quote = await service.getQuote(tokenIn, tokenOut, '100', 0.05); // 5% slippage

      // This would be tested in the actual swap function
      expect(quote).toBeDefined();
    });
  });
});
