import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService as NestConfigService } from '@nestjs/config';
import { ConfigService } from './config.service';

describe('ConfigService', () => {
  let service: ConfigService;
  let nestConfigService: jest.Mocked<NestConfigService>;

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfigService,
        {
          provide: NestConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<ConfigService>(ConfigService);
    nestConfigService = module.get(NestConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Environment Configuration', () => {
    it('should return correct node environment', () => {
      nestConfigService.get.mockReturnValue('development');
      expect(service.nodeEnv).toBe('development');
      expect(service.isDevelopment).toBe(true);
      expect(service.isProduction).toBe(false);
      expect(service.isTest).toBe(false);
    });

    it('should detect production environment', () => {
      nestConfigService.get.mockReturnValue('production');
      expect(service.isProduction).toBe(true);
      expect(service.isDevelopment).toBe(false);
    });

    it('should detect test environment', () => {
      nestConfigService.get.mockReturnValue('test');
      expect(service.isTest).toBe(true);
      expect(service.isProduction).toBe(false);
    });
  });

  describe('Bot Configuration', () => {
    it('should return bot enabled status', () => {
      nestConfigService.get.mockReturnValue(true);
      expect(service.botEnabled).toBe(true);
    });

    it('should return log level', () => {
      nestConfigService.get.mockReturnValue('info');
      expect(service.logLevel).toBe('info');
    });
  });

  describe('MEXC Configuration', () => {
    it('should return MEXC API credentials', () => {
      nestConfigService.get
        .mockReturnValueOnce('test_api_key')
        .mockReturnValueOnce('test_secret_key');

      expect(service.mexcApiKey).toBe('test_api_key');
      expect(service.mexcSecretKey).toBe('test_secret_key');
    });

    it('should return MEXC URLs', () => {
      nestConfigService.get
        .mockReturnValueOnce('https://api.mexc.com/api/v3')
        .mockReturnValueOnce('wss://wbs-api.mexc.com/ws');

      expect(service.mexcBaseUrl).toBe('https://api.mexc.com/api/v3');
      expect(service.mexcWsUrl).toBe('wss://wbs-api.mexc.com/ws');
    });
  });

  describe('BSC Configuration', () => {
    it('should return BSC configuration', () => {
      nestConfigService.get
        .mockReturnValueOnce('https://bsc-dataseed1.binance.org/')
        .mockReturnValueOnce(
          '1234567890abcdef' +
            '1234567890abcdef' +
            '1234567890abcdef' +
            '1234567890abcdef',
        )
        .mockReturnValueOnce(56);

      expect(service.bscRpcUrl).toBe('https://bsc-dataseed1.binance.org/');
      expect(service.bscWalletPrivateKey).toHaveLength(64);
      expect(service.bscChainId).toBe(56);
    });
  });

  describe('Contract Addresses', () => {
    it('should return contract addresses', () => {
      nestConfigService.get
        .mockReturnValueOnce('0x10ED43C718714eb63d5aA57B78B54704E256024E')
        .mockReturnValueOnce('0x1111111111111111111111111111111111111111')
        .mockReturnValueOnce('0x55d398326f99059fF775485246999027B3197955');

      expect(service.pancakeRouterAddress).toBe(
        '0x10ED43C718714eb63d5aA57B78B54704E256024E',
      );
      expect(service.ilmtTokenAddress).toBe(
        '0x1111111111111111111111111111111111111111',
      );
      expect(service.usdtTokenAddress).toBe(
        '0x55d398326f99059fF775485246999027B3197955',
      );
    });
  });

  describe('Trading Configuration', () => {
    it('should return trading configuration object', () => {
      const mockValues = [1.0, 500.0, 0.5, 5000, 5000.0, 20, 5];
      let callCount = 0;
      nestConfigService.get.mockImplementation(() => mockValues[callCount++]);

      const config = service.tradingConfig;

      expect(config).toEqual({
        minProfitThreshold: 1.0,
        maxTradeSize: 500.0,
        maxSlippage: 0.5,
        cooldownMs: 5000,
        maxDailyVolume: 5000.0,
        maxTradesPerHour: 20,
        maxGasPrice: 5,
      });
    });
  });

  describe('Risk Configuration', () => {
    it('should return risk management configuration', () => {
      const mockValues = [0.05, 10.0, 1.0, 0.01];
      let callCount = 0;
      nestConfigService.get.mockImplementation(() => mockValues[callCount++]);

      const config = service.riskConfig;

      expect(config).toEqual({
        emergencyStopLossRatio: 0.05,
        minBalanceThresholds: {
          usdt: 10.0,
          ilmt: 1.0,
          bnb: 0.01,
        },
      });
    });
  });

  describe('Server Configuration', () => {
    it('should return server configuration', () => {
      nestConfigService.get.mockReturnValueOnce(3000).mockReturnValueOnce(100);

      expect(service.port).toBe(3000);
      expect(service.apiRateLimit).toBe(100);
    });
  });

  describe('Config Validation', () => {
    it('should validate config successfully with valid values', () => {
      nestConfigService.get
        .mockReturnValueOnce('valid_api_key_12345')
        .mockReturnValueOnce('valid_secret_key_12345')
        .mockReturnValueOnce(
          '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        );

      expect(() => service.validateConfig()).not.toThrow();
    });

    it('should throw error for invalid MEXC API key', () => {
      nestConfigService.get
        .mockReturnValueOnce('short')
        .mockReturnValueOnce('valid_secret_key_12345')
        .mockReturnValueOnce(
          '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        );

      expect(() => service.validateConfig()).toThrow(
        'MEXC API Key appears to be invalid',
      );
    });

    it('should throw error for invalid MEXC Secret key', () => {
      nestConfigService.get
        .mockReturnValueOnce('valid_api_key_12345')
        .mockReturnValueOnce('short')
        .mockReturnValueOnce(
          '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        );

      expect(() => service.validateConfig()).toThrow(
        'MEXC Secret Key appears to be invalid',
      );
    });

    it('should throw error for invalid private key format', () => {
      nestConfigService.get
        .mockReturnValueOnce('valid_api_key_12345')
        .mockReturnValueOnce('valid_secret_key_12345')
        .mockReturnValueOnce('invalid_private_key');

      expect(() => service.validateConfig()).toThrow(
        'BSC Wallet Private Key must be 64 character hex string',
      );
    });
  });
});
