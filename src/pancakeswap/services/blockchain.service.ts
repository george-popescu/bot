import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ethers } from 'ethers';
import { LoggingService } from '../../logging/logging.service';
import {
  BlockchainServiceConfig,
  TokenInfo,
  TokenBalance,
  GasEstimate,
  SwapTransaction,
  ApprovalTransaction,
  PancakeSwapError,
  GasPriceTooHighError,
  PANCAKESWAP_CONTRACTS,
  BSC_TOKENS,
  GAS_ESTIMATES,
} from '../types/pancakeswap.types';
import { ERC20_ABI } from '../contracts/erc20.abi';
import { PANCAKE_ROUTER_ABI } from '../contracts/pancake-router.abi';

// Factory ABI (minimal for getPair)
const FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
  'function createPair(address tokenA, address tokenB) external returns (address pair)',
];

// Pair ABI (minimal for reserves)
const PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function totalSupply() external view returns (uint256)',
];

@Injectable()
export class BlockchainService implements OnModuleInit, OnModuleDestroy {
  private provider!: ethers.JsonRpcProvider;
  private wallet!: ethers.Wallet;
  private routerContract!: ethers.Contract;
  private config!: BlockchainServiceConfig;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly loggingService: LoggingService,
  ) {
    this.validateConfig();
    this.initializeProvider();
  }

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    this.disconnect();
  }

  private validateConfig(): void {
    const rpcUrl = this.configService.get<string>('BSC_RPC_URL');
    const privateKey = this.configService.get<string>('BSC_PRIVATE_KEY');
    const chainId = this.configService.get<number>('BSC_CHAIN_ID');
    const maxGasPrice = this.configService.get<string>('BSC_MAX_GAS_PRICE');

    if (!rpcUrl || !rpcUrl.startsWith('https://')) {
      throw new Error('Invalid BSC RPC URL');
    }

    if (!privateKey || privateKey.length !== 64) {
      throw new Error('Invalid BSC private key');
    }

    if (!chainId || (chainId !== 56 && chainId !== 97)) {
      throw new Error(
        'Invalid BSC chain ID (must be 56 for mainnet or 97 for testnet)',
      );
    }

    if (!maxGasPrice || parseFloat(maxGasPrice) <= 0) {
      throw new Error('Invalid BSC max gas price');
    }

    this.config = {
      provider: {
        url: rpcUrl,
        chainId: chainId,
        timeout: this.configService.get<number>('BSC_RPC_TIMEOUT') || 30000,
        retries: this.configService.get<number>('BSC_RPC_RETRIES') || 3,
      },
      wallet: {
        privateKey: privateKey,
      },
      contracts: {
        router:
          this.configService.get<string>('PANCAKE_ROUTER_ADDRESS') ||
          PANCAKESWAP_CONTRACTS.ROUTER_V2,
        factory:
          this.configService.get<string>('PANCAKE_FACTORY_ADDRESS') ||
          PANCAKESWAP_CONTRACTS.FACTORY_V2,
      },
      gas: (() => {
        const gasConfig = {
          maxGasPrice: maxGasPrice,
          gasLimitMultiplier:
            this.configService.get<number>('BSC_GAS_LIMIT_MULTIPLIER') || 1.2,
        };

        const priorityFee = this.configService.get<string>('BSC_PRIORITY_FEE');
        if (priorityFee) {
          return { ...gasConfig, priorityFee };
        }

        return gasConfig;
      })(),
      safety: {
        maxSlippage: this.configService.get<number>('BSC_MAX_SLIPPAGE') || 0.03,
        deadline: this.configService.get<number>('BSC_DEADLINE_MINUTES') || 20,
        maxTradeSize:
          this.configService.get<string>('BSC_MAX_TRADE_SIZE') || '1000',
      },
    };
  }

  private initializeProvider(): void {
    this.provider = new ethers.JsonRpcProvider(this.config.provider.url, {
      chainId: this.config.provider.chainId,
      name: this.config.provider.chainId === 56 ? 'BSC Mainnet' : 'BSC Testnet',
    });

    this.wallet = new ethers.Wallet(
      this.config.wallet.privateKey,
      this.provider,
    );

    this.routerContract = new ethers.Contract(
      this.config.contracts.router,
      PANCAKE_ROUTER_ABI,
      this.wallet,
    );

    this.setupProviderEventListeners();
  }

  private setupProviderEventListeners(): void {
    this.provider.on('error', (error) => {
      this.loggingService.info('Provider error', {
        component: 'BlockchainService',
        error: error instanceof Error ? error.message : String(error),
        code: error?.code,
      });
      this.isConnected = false;
      this.scheduleReconnect();
    });

    this.provider.on('network', (newNetwork, oldNetwork) => {
      if (oldNetwork) {
        this.loggingService.info('Network changed', {
          component: 'BlockchainService',
          oldNetwork: oldNetwork.chainId,
          newNetwork: newNetwork.chainId,
        });
      }
    });
  }

  private async connect(): Promise<void> {
    try {
      const network = await this.provider.getNetwork();
      const blockNumber = await this.provider.getBlockNumber();

      this.loggingService.info('Connected to blockchain', {
        component: 'BlockchainService',
        network: network.name,
        chainId: Number(network.chainId),
        blockNumber,
        walletAddress: this.wallet.address,
      });

      this.isConnected = true;
      this.reconnectAttempts = 0;

      this.eventEmitter.emit('blockchain.connected', {
        network: network.name,
        chainId: Number(network.chainId),
        blockNumber,
        walletAddress: this.wallet.address,
      });
    } catch (error) {
      this.loggingService.info('Failed to connect to blockchain', {
        component: 'BlockchainService',
        error: error instanceof Error ? error.message : String(error),
      });
      this.isConnected = false;
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.loggingService.info('Max reconnect attempts reached', {
        component: 'BlockchainService',
        attempts: this.reconnectAttempts,
      });
      return;
    }

    if (this.reconnectInterval) {
      clearTimeout(this.reconnectInterval);
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectInterval = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }

  private disconnect(): void {
    if (this.reconnectInterval) {
      clearTimeout(this.reconnectInterval);
      this.reconnectInterval = null;
    }

    this.provider.removeAllListeners();
    this.isConnected = false;
  }

  async getWalletAddress(): Promise<string> {
    return this.wallet.address;
  }

  async getBalance(tokenAddress?: string): Promise<string> {
    if (!tokenAddress) {
      const balance = await this.provider.getBalance(this.wallet.address);
      return ethers.formatEther(balance);
    }

    const tokenContract = new ethers.Contract(
      tokenAddress,
      ERC20_ABI,
      this.provider,
    );
    const balance = await tokenContract.balanceOf(this.wallet.address);
    const decimals = await tokenContract.decimals();

    return ethers.formatUnits(balance, decimals);
  }

  async getTokenBalance(token: TokenInfo): Promise<TokenBalance> {
    const balance = await this.getBalance(token.address);
    const balanceWei = ethers.parseUnits(balance, token.decimals);

    return {
      token,
      balance: balanceWei.toString(),
      balanceFormatted: balance,
    };
  }

  async getTokenBalances(tokens: TokenInfo[]): Promise<TokenBalance[]> {
    const balances = await Promise.all(
      tokens.map((token) => this.getTokenBalance(token)),
    );

    return balances;
  }

  async estimateGas(transaction: SwapTransaction): Promise<GasEstimate> {
    try {
      const gasLimit = await this.provider.estimateGas({
        to: transaction.to,
        data: transaction.data,
        value: transaction.value,
        from: this.wallet.address,
      });

      const adjustedGasLimit = Math.ceil(
        Number(gasLimit) * this.config.gas.gasLimitMultiplier,
      );
      const feeData = await this.provider.getFeeData();

      const gasPrice = feeData.gasPrice;
      const maxFeePerGas = feeData.maxFeePerGas;
      let maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;

      if (
        gasPrice &&
        gasPrice > ethers.parseUnits(this.config.gas.maxGasPrice, 'gwei')
      ) {
        throw new GasPriceTooHighError(
          ethers.formatUnits(gasPrice, 'gwei'),
          this.config.gas.maxGasPrice,
        );
      }

      if (this.config.gas.priorityFee) {
        maxPriorityFeePerGas = ethers.parseUnits(
          this.config.gas.priorityFee,
          'gwei',
        );
      }

      const effectiveGasPrice =
        gasPrice || maxFeePerGas || ethers.parseUnits('3', 'gwei');
      const estimatedCost = BigInt(adjustedGasLimit) * effectiveGasPrice;

      const gasEstimate: GasEstimate = {
        gasLimit: adjustedGasLimit.toString(),
        estimatedCost: ethers.formatEther(estimatedCost),
      };

      if (gasPrice) {
        gasEstimate.gasPrice = ethers.formatUnits(gasPrice, 'gwei');
      }

      if (maxFeePerGas) {
        gasEstimate.maxFeePerGas = ethers.formatUnits(maxFeePerGas, 'gwei');
      }

      if (maxPriorityFeePerGas) {
        gasEstimate.maxPriorityFeePerGas = ethers.formatUnits(
          maxPriorityFeePerGas,
          'gwei',
        );
      }

      return gasEstimate;
    } catch (error) {
      throw new PancakeSwapError(
        `Gas estimation failed: ${error instanceof Error ? error.message : String(error)}`,
        'GAS_ESTIMATION_FAILED',
        undefined,
        { transaction },
      );
    }
  }

  async sendTransaction(
    transaction: SwapTransaction,
  ): Promise<ethers.TransactionResponse> {
    try {
      const gasEstimate = await this.estimateGas(transaction);

      const tx = await this.wallet.sendTransaction({
        to: transaction.to,
        data: transaction.data,
        value: transaction.value,
        gasLimit: gasEstimate.gasLimit,
        gasPrice: transaction.gasPrice
          ? ethers.parseUnits(transaction.gasPrice, 'gwei')
          : null,
        maxFeePerGas: transaction.maxFeePerGas
          ? ethers.parseUnits(transaction.maxFeePerGas, 'gwei')
          : null,
        maxPriorityFeePerGas: transaction.maxPriorityFeePerGas
          ? ethers.parseUnits(transaction.maxPriorityFeePerGas, 'gwei')
          : null,
      });

      this.loggingService.info('Transaction sent', {
        component: 'BlockchainService',
        hash: tx.hash,
        to: transaction.to,
        gasLimit: gasEstimate.gasLimit,
        gasPrice: gasEstimate.gasPrice,
      });

      return tx;
    } catch (error) {
      throw new PancakeSwapError(
        `Transaction failed: ${error instanceof Error ? error.message : String(error)}`,
        'TRANSACTION_FAILED',
        undefined,
        { transaction },
      );
    }
  }

  async waitForTransaction(
    hash: string,
    confirmations = 1,
  ): Promise<ethers.TransactionReceipt> {
    try {
      const receipt = await this.provider.waitForTransaction(
        hash,
        confirmations,
      );

      if (!receipt) {
        throw new Error('Transaction receipt not found');
      }

      if (receipt.status === 0) {
        throw new Error('Transaction failed');
      }

      this.loggingService.info('Transaction confirmed', {
        component: 'BlockchainService',
        hash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        confirmations,
      });

      return receipt;
    } catch (error) {
      throw new PancakeSwapError(
        `Transaction confirmation failed: ${error instanceof Error ? error.message : String(error)}`,
        'TRANSACTION_CONFIRMATION_FAILED',
        hash,
      );
    }
  }

  async approveToken(
    tokenAddress: string,
    spenderAddress: string,
    amount: string,
    decimals: number,
  ): Promise<ApprovalTransaction> {
    try {
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ERC20_ABI,
        this.wallet,
      );
      const amountWei = ethers.parseUnits(amount, decimals);

      const tx = await tokenContract.approve(spenderAddress, amountWei);

      this.loggingService.info('Token approval sent', {
        component: 'BlockchainService',
        token: tokenAddress,
        spender: spenderAddress,
        amount,
        hash: tx.hash,
      });

      return {
        token: tokenAddress,
        spender: spenderAddress,
        amount: amountWei.toString(),
        transactionHash: tx.hash,
      };
    } catch (error) {
      throw new PancakeSwapError(
        `Token approval failed: ${error instanceof Error ? error.message : String(error)}`,
        'APPROVAL_FAILED',
        undefined,
        { tokenAddress, spenderAddress, amount },
      );
    }
  }

  async getAllowance(
    tokenAddress: string,
    ownerAddress: string,
    spenderAddress: string,
  ): Promise<string> {
    try {
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ERC20_ABI,
        this.provider,
      );
      const allowance = await tokenContract.allowance(
        ownerAddress,
        spenderAddress,
      );

      return allowance.toString();
    } catch (error) {
      throw new PancakeSwapError(
        `Failed to get allowance: ${error instanceof Error ? error.message : String(error)}`,
        'ALLOWANCE_CHECK_FAILED',
        undefined,
        { tokenAddress, ownerAddress, spenderAddress },
      );
    }
  }

  async getTokenInfo(tokenAddress: string): Promise<TokenInfo> {
    try {
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ERC20_ABI,
        this.provider,
      );

      const [symbol, name, decimals] = await Promise.all([
        tokenContract.symbol(),
        tokenContract.name(),
        tokenContract.decimals(),
      ]);

      return {
        address: tokenAddress,
        symbol,
        name,
        decimals: Number(decimals),
      };
    } catch (error) {
      throw new PancakeSwapError(
        `Failed to get token info: ${error instanceof Error ? error.message : String(error)}`,
        'TOKEN_INFO_FAILED',
        undefined,
        { tokenAddress },
      );
    }
  }

  async getBlockNumber(): Promise<number> {
    return await this.provider.getBlockNumber();
  }

  async getGasPrice(): Promise<string> {
    const feeData = await this.provider.getFeeData();
    const gasPrice =
      feeData.gasPrice ||
      feeData.maxFeePerGas ||
      ethers.parseUnits('3', 'gwei'); // Reduced from 5 to 3 gwei

    return ethers.formatUnits(gasPrice, 'gwei');
  }

  getRouterContract(): ethers.Contract {
    return this.routerContract;
  }

  getFactoryContract(): ethers.Contract {
    return new ethers.Contract(
      this.config.contracts.factory,
      FACTORY_ABI,
      this.provider,
    );
  }

  getPairContract(pairAddress: string): ethers.Contract {
    return new ethers.Contract(
      pairAddress,
      PAIR_ABI,
      this.provider,
    );
  }

  getProvider(): ethers.JsonRpcProvider {
    return this.provider;
  }

  getWallet(): ethers.Wallet {
    return this.wallet;
  }

  getConfig(): Omit<BlockchainServiceConfig, 'wallet'> {
    return {
      provider: this.config.provider,
      contracts: this.config.contracts,
      gas: this.config.gas,
      safety: this.config.safety,
    };
  }

  isProviderConnected(): boolean {
    return this.isConnected;
  }
}
