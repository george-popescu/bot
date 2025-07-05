import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LoggingService } from '../../logging/logging.service';
import { BlockchainService } from './blockchain.service';
import {
  PancakeSwapError,
  GasPriceTooHighError,
} from '../types/pancakeswap.types';

// Mock ethers
jest.mock('ethers', () => ({
  ethers: {
    JsonRpcProvider: jest.fn().mockImplementation(() => ({
      getNetwork: jest
        .fn()
        .mockResolvedValue({ name: 'BSC Testnet', chainId: 97n }),
      getBlockNumber: jest.fn().mockResolvedValue(12345),
      getBalance: jest.fn().mockResolvedValue(1000000000000000000n), // 1 BNB
      estimateGas: jest.fn().mockResolvedValue(200000n),
      getFeeData: jest.fn().mockResolvedValue({
        gasPrice: 5000000000n, // 5 gwei
        maxFeePerGas: 5000000000n,
        maxPriorityFeePerGas: 2000000000n,
      }),
      waitForTransaction: jest.fn().mockResolvedValue({
        hash: '0x123abc',
        blockNumber: 12346,
        gasUsed: 180000n,
        gasPrice: 5000000000n,
        status: 1,
      }),
      on: jest.fn(),
      removeAllListeners: jest.fn(),
    })),
    Wallet: jest.fn().mockImplementation(() => ({
      address: '0x1234567890123456789012345678901234567890',
      sendTransaction: jest.fn().mockResolvedValue({
        hash: '0x123abc',
        wait: jest.fn().mockResolvedValue({
          hash: '0x123abc',
          blockNumber: 12346,
          gasUsed: 180000n,
          status: 1,
        }),
      }),
    })),
    Contract: jest.fn().mockImplementation(() => ({
      balanceOf: jest.fn().mockResolvedValue(1000000000000000000n),
      decimals: jest.fn().mockResolvedValue(18),
      symbol: jest.fn().mockResolvedValue('TEST'),
      name: jest.fn().mockResolvedValue('Test Token'),
      approve: jest.fn().mockResolvedValue({
        hash: '0x456def',
        wait: jest.fn().mockResolvedValue({ status: 1 }),
      }),
      allowance: jest.fn().mockResolvedValue(0n),
    })),
    formatEther: jest
      .fn()
      .mockImplementation((value) => (Number(value) / 1e18).toString()),
    formatUnits: jest.fn().mockImplementation((value, decimals = 18) => {
      const num = Number(value) / Math.pow(10, decimals);
      return num.toString();
    }),
    parseUnits: jest.fn().mockImplementation((value, decimals = 18) => {
      const num = parseFloat(value);
      if (isNaN(num)) return 0n;
      return BigInt(Math.floor(num * Math.pow(10, decimals)));
    }),
    parseEther: jest.fn().mockImplementation((value) => {
      const num = parseFloat(value);
      if (isNaN(num)) return 0n;
      return BigInt(Math.floor(num * 1e18));
    }),
  },
}));

describe('BlockchainService', () => {
  let service: BlockchainService;
  let configService: jest.Mocked<ConfigService>;
  let eventEmitter: jest.Mocked<EventEmitter2>;
  let loggingService: jest.Mocked<LoggingService>;

  const mockConfig = {
    BSC_RPC_URL: 'https://data-seed-prebsc-1-s1.binance.org:8545',
    BSC_PRIVATE_KEY:
      '0123456789012345678901234567890123456789012345678901234567890123',
    BSC_CHAIN_ID: 97,
    BSC_MAX_GAS_PRICE: '10',
    BSC_RPC_TIMEOUT: 30000,
    BSC_RPC_RETRIES: 3,
    BSC_GAS_LIMIT_MULTIPLIER: 1.2,
    BSC_PRIORITY_FEE: '2',
    BSC_MAX_SLIPPAGE: 0.03,
    BSC_DEADLINE_MINUTES: 20,
    BSC_MAX_TRADE_SIZE: '1000',
    PANCAKE_ROUTER_ADDRESS: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
    PANCAKE_FACTORY_ADDRESS: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlockchainService,
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
      ],
    }).compile();

    service = module.get<BlockchainService>(BlockchainService);
    configService = module.get(ConfigService);
    eventEmitter = module.get(EventEmitter2);
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

  describe('Configuration Validation', () => {
    it('should validate RPC URL', () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'BSC_RPC_URL') return 'http://invalid-url';
        return mockConfig[key as keyof typeof mockConfig];
      });

      expect(
        () =>
          new BlockchainService(configService, eventEmitter, loggingService),
      ).toThrow('Invalid BSC RPC URL');
    });

    it('should validate private key', () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'BSC_PRIVATE_KEY') return 'short_key';
        return mockConfig[key as keyof typeof mockConfig];
      });

      expect(
        () =>
          new BlockchainService(configService, eventEmitter, loggingService),
      ).toThrow('Invalid BSC private key');
    });

    it('should validate chain ID', () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'BSC_CHAIN_ID') return 1; // Invalid chain ID
        return mockConfig[key as keyof typeof mockConfig];
      });

      expect(
        () =>
          new BlockchainService(configService, eventEmitter, loggingService),
      ).toThrow('Invalid BSC chain ID');
    });

    it('should validate max gas price', () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'BSC_MAX_GAS_PRICE') return '0';
        return mockConfig[key as keyof typeof mockConfig];
      });

      expect(
        () =>
          new BlockchainService(configService, eventEmitter, loggingService),
      ).toThrow('Invalid BSC max gas price');
    });
  });

  describe('Wallet Operations', () => {
    it('should return wallet address', async () => {
      const address = await service.getWalletAddress();
      expect(address).toBe('0x1234567890123456789012345678901234567890');
    });

    it('should get BNB balance', async () => {
      const balance = await service.getBalance();
      expect(balance).toBe('1'); // 1 BNB
    });

    it('should get token balance', async () => {
      const tokenAddress = '0x55d398326f99059fF775485246999027B3197955';
      const balance = await service.getBalance(tokenAddress);
      expect(balance).toBe('1'); // 1 token
    });

    it('should get token info', async () => {
      const tokenAddress = '0x55d398326f99059fF775485246999027B3197955';
      const tokenInfo = await service.getTokenInfo(tokenAddress);

      expect(tokenInfo).toEqual({
        address: tokenAddress,
        symbol: 'TEST',
        name: 'Test Token',
        decimals: 18,
      });
    });

    it('should get multiple token balances', async () => {
      const tokens = [
        {
          address: '0x55d398326f99059fF775485246999027B3197955',
          symbol: 'USDT',
          decimals: 18,
        },
        {
          address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
          symbol: 'USDC',
          decimals: 18,
        },
      ];

      const balances = await service.getTokenBalances(tokens);

      expect(balances).toHaveLength(2);
      expect(balances[0]).toEqual({
        token: tokens[0],
        balance: '1000000000000000000',
        balanceFormatted: '1',
      });
    });
  });

  describe('Gas Management', () => {
    it('should estimate gas for transaction', async () => {
      const transaction = {
        to: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
        data: '0x',
        value: '0',
        gasLimit: '200000',
      };

      const gasEstimate = await service.estimateGas(transaction);

      expect(gasEstimate).toEqual({
        gasLimit: '240000', // 200000 * 1.2
        gasPrice: '5', // 5 gwei
        maxFeePerGas: '5',
        maxPriorityFeePerGas: '2',
        estimatedCost: expect.any(String),
      });
    });

    it('should throw error when gas price is too high', async () => {
      const mockProvider = service.getProvider();
      mockProvider.getFeeData = jest.fn().mockResolvedValue({
        gasPrice: 15000000000n, // 15 gwei (higher than max 10 gwei)
        maxFeePerGas: 15000000000n,
        maxPriorityFeePerGas: 2000000000n,
      });

      const transaction = {
        to: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
        data: '0x',
        value: '0',
        gasLimit: '200000',
      };

      await expect(service.estimateGas(transaction)).rejects.toThrow(
        GasPriceTooHighError,
      );
    });

    it('should get current gas price', async () => {
      const gasPrice = await service.getGasPrice();
      expect(gasPrice).toBe('5'); // 5 gwei
    });
  });

  describe('Transaction Operations', () => {
    it('should send transaction', async () => {
      const transaction = {
        to: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
        data: '0x',
        value: '0',
        gasLimit: '200000',
      };

      const tx = await service.sendTransaction(transaction);

      expect(tx).toEqual({
        hash: '0x123abc',
        wait: expect.any(Function),
      });

      expect(loggingService.info).toHaveBeenCalledWith(
        'Transaction sent',
        expect.objectContaining({
          component: 'BlockchainService',
          hash: '0x123abc',
        }),
      );
    });

    it('should wait for transaction confirmation', async () => {
      const receipt = await service.waitForTransaction('0x123abc');

      expect(receipt).toEqual({
        hash: '0x123abc',
        blockNumber: 12346,
        gasUsed: 180000n,
        gasPrice: 5000000000n,
        status: 1,
      });

      expect(loggingService.info).toHaveBeenCalledWith(
        'Transaction confirmed',
        expect.objectContaining({
          component: 'BlockchainService',
          hash: '0x123abc',
        }),
      );
    });

    it('should handle failed transaction', async () => {
      const mockProvider = service.getProvider();
      mockProvider.waitForTransaction = jest.fn().mockResolvedValue({
        hash: '0x123abc',
        blockNumber: 12346,
        gasUsed: 180000n,
        status: 0, // Failed
      });

      await expect(service.waitForTransaction('0x123abc')).rejects.toThrow(
        'Transaction failed',
      );
    });
  });

  describe('Token Approval', () => {
    it('should approve token spend', async () => {
      const tokenAddress = '0x55d398326f99059fF775485246999027B3197955';
      const spenderAddress = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
      const amount = '100';
      const decimals = 18;

      const approval = await service.approveToken(
        tokenAddress,
        spenderAddress,
        amount,
        decimals,
      );

      expect(approval).toEqual({
        token: tokenAddress,
        spender: spenderAddress,
        amount: '100000000000000000000', // 100 * 10^18
        transactionHash: '0x456def',
      });

      expect(loggingService.info).toHaveBeenCalledWith(
        'Token approval sent',
        expect.objectContaining({
          component: 'BlockchainService',
          token: tokenAddress,
          spender: spenderAddress,
          amount: '100',
          hash: '0x456def',
        }),
      );
    });

    it('should get token allowance', async () => {
      const tokenAddress = '0x55d398326f99059fF775485246999027B3197955';
      const ownerAddress = '0x1234567890123456789012345678901234567890';
      const spenderAddress = '0x10ED43C718714eb63d5aA57B78B54704E256024E';

      const allowance = await service.getAllowance(
        tokenAddress,
        ownerAddress,
        spenderAddress,
      );

      expect(allowance).toBe('0');
    });

    it('should handle approval errors', async () => {
      const { ethers } = require('ethers');

      // Mock the contract constructor to return a contract that throws
      const originalContract = ethers.Contract;
      ethers.Contract = jest.fn().mockImplementation(() => ({
        approve: jest.fn().mockRejectedValue(new Error('Approval failed')),
      }));

      const tokenAddress = '0x55d398326f99059fF775485246999027B3197955';
      const spenderAddress = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
      const amount = '100';
      const decimals = 18;

      await expect(
        service.approveToken(tokenAddress, spenderAddress, amount, decimals),
      ).rejects.toThrow(PancakeSwapError);

      // Restore original
      ethers.Contract = originalContract;
    });
  });

  describe('Blockchain Info', () => {
    it('should get block number', async () => {
      const blockNumber = await service.getBlockNumber();
      expect(blockNumber).toBe(12345);
    });

    it('should provide access to contracts and provider', () => {
      const router = service.getRouterContract();
      const provider = service.getProvider();
      const wallet = service.getWallet();

      expect(router).toBeDefined();
      expect(provider).toBeDefined();
      expect(wallet).toBeDefined();
    });

    it('should return config without sensitive data', () => {
      const config = service.getConfig();

      expect(config).toHaveProperty('provider');
      expect(config).toHaveProperty('contracts');
      expect(config).toHaveProperty('gas');
      expect(config).toHaveProperty('safety');
      expect(config).not.toHaveProperty('wallet');
    });

    it('should return connection status', () => {
      const isConnected = service.isProviderConnected();
      expect(typeof isConnected).toBe('boolean');
    });
  });

  describe('Error Handling', () => {
    it('should handle gas estimation errors', async () => {
      const mockProvider = service.getProvider();
      mockProvider.estimateGas = jest
        .fn()
        .mockRejectedValue(new Error('Gas estimation failed'));

      const transaction = {
        to: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
        data: '0x',
        value: '0',
        gasLimit: '200000',
      };

      await expect(service.estimateGas(transaction)).rejects.toThrow(
        PancakeSwapError,
      );
    });

    it('should handle transaction errors', async () => {
      const mockWallet = service.getWallet();
      mockWallet.sendTransaction = jest
        .fn()
        .mockRejectedValue(new Error('Transaction failed'));

      const transaction = {
        to: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
        data: '0x',
        value: '0',
        gasLimit: '200000',
      };

      await expect(service.sendTransaction(transaction)).rejects.toThrow(
        PancakeSwapError,
      );
    });

    it('should handle token info errors', async () => {
      const { ethers } = require('ethers');

      // Mock the contract constructor to return a contract that throws
      const originalContract = ethers.Contract;
      ethers.Contract = jest.fn().mockImplementation(() => ({
        symbol: jest.fn().mockRejectedValue(new Error('Symbol failed')),
        name: jest.fn().mockRejectedValue(new Error('Name failed')),
        decimals: jest.fn().mockRejectedValue(new Error('Decimals failed')),
      }));

      const tokenAddress = '0x55d398326f99059fF775485246999027B3197955';

      await expect(service.getTokenInfo(tokenAddress)).rejects.toThrow(
        PancakeSwapError,
      );

      // Restore original
      ethers.Contract = originalContract;
    });
  });
});
