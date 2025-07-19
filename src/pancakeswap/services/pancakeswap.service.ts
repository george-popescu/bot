import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ethers } from 'ethers';
import { BlockchainService } from './blockchain.service';
import { LoggingService } from '../../logging/logging.service';
import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  TokenInfo,
  SwapPath,
  SwapResult,
  SwapTransaction,
  PriceQuote,
  LiquidityPool,
  PairReserves,
  SwapDirection,
  PancakeSwapError,
  InsufficientLiquidityError,
  SlippageExceededError,
  PANCAKESWAP_CONTRACTS,
  BSC_TOKENS,
  PANCAKE_SWAP_FEES,
  GAS_ESTIMATES,
  SLIPPAGE_PRESETS,
} from '../types/pancakeswap.types';

@Injectable()
export class PancakeSwapService {
  constructor(
    private readonly blockchainService: BlockchainService,
    private readonly eventEmitter: EventEmitter2,
    private readonly loggingService: LoggingService,
  ) {}

    async getAmountsOut(amountIn: string, path: string[]): Promise<string[]> {
    try {
      const router = this.blockchainService.getRouterContract();

      // 🔍 DEBUG: Log contract details WITH explicit router address
      const routerAddress = await router.getAddress();
      const expectedRouterAddress = PANCAKESWAP_CONTRACTS.ROUTER_V2;
      
      this.loggingService.info('🔍 DEBUG getAmountsOut - ROUTER CHECK', {
        component: 'PancakeSwapService',
        actualRouterAddress: routerAddress,
        expectedRouterAddress: expectedRouterAddress,
        addressesMatch: routerAddress.toLowerCase() === expectedRouterAddress.toLowerCase(),
        amountIn,
        path,
      });

      // FORȚEZ explicit router address-ul corect
      if (routerAddress.toLowerCase() !== expectedRouterAddress.toLowerCase()) {
        this.loggingService.error('❌ ROUTER ADDRESS MISMATCH!', `Expected: ${expectedRouterAddress}, Actual: ${routerAddress}`);
        throw new Error(`Router address mismatch: expected ${expectedRouterAddress}, got ${routerAddress}`);
      }

      const amounts = await router.getAmountsOut(amountIn, path);

      return amounts.map((amount: bigint) => amount.toString());
    } catch (error) {
      // 🔍 DEBUG: Log detailed error info
      this.loggingService.info('❌ getAmountsOut failed', {
        component: 'PancakeSwapService',
        error: error instanceof Error ? error.message : String(error),
        amountIn,
        path,
      });

      throw new PancakeSwapError(
        `Failed to get amounts out: ${error instanceof Error ? error.message : String(error)}`,
        'AMOUNTS_OUT_FAILED',
        undefined,
        { amountIn, path },
      );
    }
  }

  async getAmountsIn(amountOut: string, path: string[]): Promise<string[]> {
    try {
      const router = this.blockchainService.getRouterContract();
      const amounts = await router.getAmountsIn(amountOut, path);

      return amounts.map((amount: bigint) => amount.toString());
    } catch (error) {
      throw new PancakeSwapError(
        `Failed to get amounts in: ${error instanceof Error ? error.message : String(error)}`,
        'AMOUNTS_IN_FAILED',
        undefined,
        { amountOut, path },
      );
    }
  }

  async getQuote(
    tokenIn: TokenInfo,
    tokenOut: TokenInfo,
    amountIn: string,
    slippage: number = SLIPPAGE_PRESETS.MEDIUM,
  ): Promise<PriceQuote> {
    try {
      const path = this.getSwapPath(tokenIn, tokenOut);
      const amountInWei = ethers.parseUnits(amountIn, tokenIn.decimals);

      const amounts = await this.getAmountsOut(amountInWei.toString(), path);
      const amountOutWei = amounts[amounts.length - 1];
      const amountOut = ethers.formatUnits(amountOutWei, tokenOut.decimals);

      const minimumAmountOut = this.calculateMinimumAmountOut(
        amountOut,
        slippage,
      );
      const priceImpact = await this.calculatePriceImpact(
        tokenIn,
        tokenOut,
        amountIn,
        amountOut,
      );

      // Create mock transaction for gas estimation
      const mockTransaction: SwapTransaction = {
        to: PANCAKESWAP_CONTRACTS.ROUTER_V2,
        data: '0x', // Will be populated in actual swap
        value: '0',
        gasLimit: GAS_ESTIMATES.SWAP,
      };

      const gasEstimate =
        await this.blockchainService.estimateGas(mockTransaction);

      return {
        tokenIn,
        tokenOut,
        amountIn,
        amountOut,
        priceImpact,
        minimumAmountOut,
        route: path,
        gasEstimate,
      };
    } catch (error) {
      throw new PancakeSwapError(
        `Failed to get quote: ${error instanceof Error ? error.message : String(error)}`,
        'QUOTE_FAILED',
        undefined,
        { tokenIn: tokenIn.symbol, tokenOut: tokenOut.symbol, amountIn },
      );
    }
  }

  async swapExactTokensForTokens(
    tokenIn: TokenInfo,
    tokenOut: TokenInfo,
    amountIn: string,
    slippage: number = SLIPPAGE_PRESETS.MEDIUM,
  ): Promise<SwapResult> {
    try {
      const path = this.getSwapPath(tokenIn, tokenOut);
      const amountInWei = ethers.parseUnits(amountIn, tokenIn.decimals);

      const amounts = await this.getAmountsOut(amountInWei.toString(), path);
      const amountOutWei = amounts[amounts.length - 1];
      const amountOut = ethers.formatUnits(amountOutWei, tokenOut.decimals);

      const minimumAmountOut = this.calculateMinimumAmountOut(
        amountOut,
        slippage,
      );
      const minimumAmountOutWei = ethers.parseUnits(
        minimumAmountOut,
        tokenOut.decimals,
      );

      await this.ensureTokenApproval(tokenIn.address, amountInWei.toString());

      const router = this.blockchainService.getRouterContract();
      const walletAddress = await this.blockchainService.getWalletAddress();
      const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 minutes

      const tx = await router.swapExactTokensForTokens(
        amountInWei,
        minimumAmountOutWei,
        path,
        walletAddress,
        deadline,
      );

      // 📝 ON-CHAIN TRANSACTION LOGGING
      this.logOnChainTransaction({
        type: 'SWAP',
        hash: tx.hash,
        from: walletAddress,
        to: PANCAKESWAP_CONTRACTS.ROUTER_V2,
        tokenIn: {
          symbol: tokenIn.symbol,
          address: tokenIn.address,
          amount: amountIn,
          decimals: tokenIn.decimals,
        },
        tokenOut: {
          symbol: tokenOut.symbol,
          address: tokenOut.address,
          amount: amountOut,
          decimals: tokenOut.decimals,
        },
        gasLimit: tx.gasLimit?.toString() || '150000',
        gasPrice: tx.gasPrice ? ethers.formatUnits(tx.gasPrice, 'gwei') : '3',
        exchange: 'PANCAKESWAP',
        slippage,
        priceImpact: await this.calculatePriceImpact(tokenIn, tokenOut, amountIn, amountOut),
      });

      this.loggingService.info('Swap transaction sent', {
        component: 'PancakeSwapService',
        operation: 'SWAP_EXACT_TOKENS_FOR_TOKENS',
        hash: tx.hash,
        tokenIn: tokenIn.symbol,
        tokenOut: tokenOut.symbol,
        amountIn,
        expectedAmountOut: amountOut,
        minimumAmountOut,
      });

      const receipt = await this.blockchainService.waitForTransaction(tx.hash);

      const swapResult: SwapResult = {
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPrice: receipt.gasPrice?.toString() || '0',
        amountIn,
        amountOut, // This should be parsed from logs in a real implementation
        path,
        timestamp: new Date(),
        success: receipt.status === 1,
      };

      this.eventEmitter.emit('pancakeswap.swap.completed', swapResult);

      return swapResult;
    } catch (error) {
      const errorMessage = `Swap failed: ${error instanceof Error ? error.message : String(error)}`;
      this.loggingService.info(errorMessage, {
        component: 'PancakeSwapService',
        operation: 'SWAP_EXACT_TOKENS_FOR_TOKENS',
        error: error instanceof Error ? error.message : String(error),
        tokenIn: tokenIn.symbol,
        tokenOut: tokenOut.symbol,
        amountIn,
      });

      throw new PancakeSwapError(errorMessage, 'SWAP_FAILED', undefined, {
        tokenIn: tokenIn.symbol,
        tokenOut: tokenOut.symbol,
        amountIn,
      });
    }
  }

  async swapTokensForExactTokens(
    tokenIn: TokenInfo,
    tokenOut: TokenInfo,
    amountOut: string,
    slippage: number = SLIPPAGE_PRESETS.MEDIUM,
  ): Promise<SwapResult> {
    try {
      const path = this.getSwapPath(tokenIn, tokenOut);
      const amountOutWei = ethers.parseUnits(amountOut, tokenOut.decimals);

      const amounts = await this.getAmountsIn(amountOutWei.toString(), path);
      const amountInWei = amounts[0];
      const amountIn = ethers.formatUnits(amountInWei, tokenIn.decimals);

      const maximumAmountIn = this.calculateMaximumAmountIn(amountIn, slippage);
      const maximumAmountInWei = ethers.parseUnits(
        maximumAmountIn,
        tokenIn.decimals,
      );

      await this.ensureTokenApproval(tokenIn.address, maximumAmountInWei.toString());

      const router = this.blockchainService.getRouterContract();
      const walletAddress = await this.blockchainService.getWalletAddress();
      const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 minutes

      const tx = await router.swapTokensForExactTokens(
        amountOutWei,
        maximumAmountInWei,
        path,
        walletAddress,
        deadline,
      );

      this.loggingService.info('Swap transaction sent', {
        component: 'PancakeSwapService',
        operation: 'SWAP_TOKENS_FOR_EXACT_TOKENS',
        hash: tx.hash,
        tokenIn: tokenIn.symbol,
        tokenOut: tokenOut.symbol,
        expectedAmountIn: amountIn,
        maximumAmountIn,
        amountOut,
      });

      const receipt = await this.blockchainService.waitForTransaction(tx.hash);

      const swapResult: SwapResult = {
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPrice: receipt.gasPrice?.toString() || '0',
        amountIn, // This should be parsed from logs in a real implementation
        amountOut,
        path,
        timestamp: new Date(),
        success: receipt.status === 1,
      };

      this.eventEmitter.emit('pancakeswap.swap.completed', swapResult);

      return swapResult;
    } catch (error) {
      const errorMessage = `Swap failed: ${error instanceof Error ? error.message : String(error)}`;
      this.loggingService.info(errorMessage, {
        component: 'PancakeSwapService',
        operation: 'SWAP_TOKENS_FOR_EXACT_TOKENS',
        error: error instanceof Error ? error.message : String(error),
        tokenIn: tokenIn.symbol,
        tokenOut: tokenOut.symbol,
        amountOut,
      });

      throw new PancakeSwapError(errorMessage, 'SWAP_FAILED', undefined, {
        tokenIn: tokenIn.symbol,
        tokenOut: tokenOut.symbol,
        amountOut,
      });
    }
  }

  private getSwapPath(tokenIn: TokenInfo, tokenOut: TokenInfo): string[] {
    // Handle ILMT/USDT direct pair (known to exist)
    if (
      (tokenIn.symbol === 'ILMT' && tokenOut.symbol === 'USDT') ||
      (tokenIn.symbol === 'USDT' && tokenOut.symbol === 'ILMT')
    ) {
      return [tokenIn.address, tokenOut.address];
    }

    // Direct swap if both tokens are major tokens
    if (this.isMajorToken(tokenIn) && this.isMajorToken(tokenOut)) {
      return [tokenIn.address, tokenOut.address];
    }

    // Route through WBNB for other tokens
    if (tokenIn.address === BSC_TOKENS.WBNB.address) {
      return [tokenIn.address, tokenOut.address];
    }

    if (tokenOut.address === BSC_TOKENS.WBNB.address) {
      return [tokenIn.address, tokenOut.address];
    }

    return [tokenIn.address, BSC_TOKENS.WBNB.address, tokenOut.address];
  }

  private isMajorToken(token: TokenInfo): boolean {
    const majorTokens = [
      BSC_TOKENS.WBNB.address.toLowerCase(),
      BSC_TOKENS.USDT.address.toLowerCase(),
      BSC_TOKENS.USDC.address.toLowerCase(),
    ];
    return majorTokens.includes(token.address.toLowerCase());
  }

  private calculateMinimumAmountOut(
    amountOut: string,
    slippage: number,
  ): string {
    const amount = parseFloat(amountOut);
    const minimumAmount = amount * (1 - slippage);
    return minimumAmount.toFixed(8);
  }

  private calculateMaximumAmountIn(amountIn: string, slippage: number): string {
    const amount = parseFloat(amountIn);
    const maximumAmount = amount * (1 + slippage);
    return maximumAmount.toFixed(8);
  }

  private async calculatePriceImpact(
    tokenIn: TokenInfo,
    tokenOut: TokenInfo,
    amountIn: string,
    amountOut: string,
  ): Promise<string> {
    try {
      // This is a simplified price impact calculation
      // In a real implementation, you would get the reserves from the pair contract
      const smallAmount = '1';
      const smallAmountWei = ethers.parseUnits(smallAmount, tokenIn.decimals);
      const path = this.getSwapPath(tokenIn, tokenOut);

      const smallAmounts = await this.getAmountsOut(
        smallAmountWei.toString(),
        path,
      );
      const smallAmountOut = ethers.formatUnits(
        smallAmounts[smallAmounts.length - 1],
        tokenOut.decimals,
      );

      const normalPrice = parseFloat(smallAmountOut) / parseFloat(smallAmount);
      const executionPrice = parseFloat(amountOut) / parseFloat(amountIn);

      const priceImpact = Math.abs(
        (executionPrice - normalPrice) / normalPrice,
      );

      return (priceImpact * 100).toFixed(4); // Return as percentage
    } catch (error) {
      return '0.0000'; // Return 0% if calculation fails
    }
  }

  /**
   * Asigură approval pentru token (o singură dată cu suma maximă)
   * Bazat pe implementarea React
   */
  private async ensureTokenApproval(tokenAddress: string, amount: string): Promise<void> {
    try {
      const wallet = this.blockchainService.getWallet();
      const routerAddress = PANCAKESWAP_CONTRACTS.ROUTER_V2;
      
      // Verifică allowance curent
      const currentAllowance = await this.blockchainService.getAllowance(
        tokenAddress,
        wallet.address,
        routerAddress
      );
      
      const requiredAmount = ethers.parseUnits(amount, 18);

      if (BigInt(currentAllowance) < requiredAmount) {
        this.loggingService.info('🔓 Token approval needed - approving MAX amount...', {
          component: 'PancakeSwapService',
          tokenAddress,
          currentAllowance: currentAllowance.toString(),
          requiredAmount: requiredAmount.toString()
        });
        
        // 📊 OPTIMIZED GAS for approval
        const gasSettings = await this.calculateOptimizedGasSettings('approve');
        
        this.loggingService.info('🔓 Applying gas optimization for token approval:', {
          component: 'PancakeSwapService',
          gasLimit: gasSettings.gasLimit,
          gasPrice: `${gasSettings.gasPrice} gwei`,
          estimatedCost: `${gasSettings.estimatedCost} BNB`
        });
        
        // 📝 LOG APPROVAL TRANSACTION
        this.logOnChainTransaction({
          type: 'APPROVAL',
          from: this.blockchainService.getWallet().address,
          to: tokenAddress,
          gasLimit: gasSettings.gasLimit.toString(),
          gasPrice: gasSettings.gasPrice,
          exchange: 'PANCAKESWAP',
        });

        // Approve MAX pentru a evita approval-uri viitoare  
        const approval = await this.blockchainService.approveToken(
          tokenAddress,
          routerAddress,
          ethers.formatUnits(ethers.MaxUint256, 18),
          18
        );
        
        this.loggingService.info('📝 Approval transaction sent', {
          component: 'PancakeSwapService',
          txHash: approval.transactionHash
        });
        
        await this.blockchainService.waitForTransaction(approval.transactionHash!);
        this.loggingService.info('✅ Token approved successfully (MAX amount)');
      }
    } catch (error) {
      this.loggingService.error('❌ Token approval failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async getTokenBalance(token: TokenInfo): Promise<string> {
    return await this.blockchainService.getBalance(token.address);
  }

  async getTokenBalances(
    tokens: TokenInfo[],
  ): Promise<{ [symbol: string]: string }> {
    const balances: { [symbol: string]: string } = {};

    for (const token of tokens) {
      balances[token.symbol] = await this.getTokenBalance(token);
    }

    return balances;
  }

  async getBNBBalance(): Promise<string> {
    return await this.blockchainService.getBalance();
  }

  getSupportedTokens(): TokenInfo[] {
    return Object.values(BSC_TOKENS);
  }

  getRouterAddress(): string {
    return PANCAKESWAP_CONTRACTS.ROUTER_V2;
  }

  getFactoryAddress(): string {
    return PANCAKESWAP_CONTRACTS.FACTORY_V2;
  }

  getTradingFees(): typeof PANCAKE_SWAP_FEES {
    return PANCAKE_SWAP_FEES;
  }

  getSlippagePresets(): typeof SLIPPAGE_PRESETS {
    return SLIPPAGE_PRESETS;
  }

  async getPairReserves(
    tokenA: TokenInfo,
    tokenB: TokenInfo,
  ): Promise<PairReserves> {
    try {
      const factory = this.blockchainService.getFactoryContract();
      const pairAddress = await factory.getPair(tokenA.address, tokenB.address);

      if (pairAddress === ethers.ZeroAddress) {
        throw new InsufficientLiquidityError(tokenA.symbol, tokenB.symbol);
      }

      const pairContract = this.blockchainService.getPairContract(pairAddress);
      const reserves = await pairContract.getReserves();

      // Get token0 and token1 from the pair
      const token0 = await pairContract.token0();
      const token1 = await pairContract.token1();

      // Determine which token is which
      const isToken0A = token0.toLowerCase() === tokenA.address.toLowerCase();

      return {
        token0: isToken0A ? tokenA.address : tokenB.address,
        token1: isToken0A ? tokenB.address : tokenA.address,
        reserve0: reserves[0].toString(),
        reserve1: reserves[1].toString(),
        blockTimestampLast: reserves[2],
      };
    } catch (error) {
      throw new PancakeSwapError(
        `Failed to get pair reserves: ${error instanceof Error ? error.message : String(error)}`,
        'RESERVES_FAILED',
        undefined,
        { tokenA: tokenA.symbol, tokenB: tokenB.symbol },
      );
    }
  }

  async calculatePriceFromReserves(
    tokenA: TokenInfo,
    tokenB: TokenInfo,
    amountA: string = '1',
  ): Promise<{
    price: string;
    priceFormatted: string;
    reserves: PairReserves;
    liquidityUsd?: string;
  }> {
    try {
      const reserves = await this.getPairReserves(tokenA, tokenB);

      // Determine which reserve corresponds to which token
      const isToken0A =
        reserves.token0.toLowerCase() === tokenA.address.toLowerCase();
      const reserveA = isToken0A ? reserves.reserve0 : reserves.reserve1;
      const reserveB = isToken0A ? reserves.reserve1 : reserves.reserve0;

      // Convert reserves to proper decimals
      const reserveAFormatted = ethers.formatUnits(reserveA, tokenA.decimals);
      const reserveBFormatted = ethers.formatUnits(reserveB, tokenB.decimals);

      // Calculate price: price = reserveB / reserveA
      const reserveABig = parseFloat(reserveAFormatted);
      const reserveBBig = parseFloat(reserveBFormatted);

      if (reserveABig === 0) {
        throw new InsufficientLiquidityError(tokenA.symbol, tokenB.symbol);
      }

      const price = reserveBBig / reserveABig;
      const priceFormatted = price.toFixed(8);

      // Calculate liquidity in USD if one token is USDT
      let liquidityUsd: string | undefined;
      if (tokenB.symbol === 'USDT') {
        liquidityUsd = (parseFloat(reserveBFormatted) * 2).toFixed(2);
      } else if (tokenA.symbol === 'USDT') {
        liquidityUsd = (parseFloat(reserveAFormatted) * 2).toFixed(2);
      }

      this.loggingService.info('Price calculated from reserves', {
        component: 'PancakeSwapService',
        operation: 'CALCULATE_PRICE_FROM_RESERVES',
        pair: `${tokenA.symbol}/${tokenB.symbol}`,
        price: priceFormatted,
        reserveA: reserveAFormatted,
        reserveB: reserveBFormatted,
        liquidityUsd,
      });

      return {
        price: priceFormatted,
        priceFormatted,
        reserves,
        ...(liquidityUsd && { liquidityUsd }),
      };
    } catch (error) {
      this.loggingService.error(
        'Failed to calculate price from reserves',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  async calculateSwapAmountOut(
    tokenIn: TokenInfo,
    tokenOut: TokenInfo,
    amountIn: string,
  ): Promise<{
    amountOut: string;
    priceImpact: string;
    effectivePrice: string;
  }> {
    try {
      const reserves = await this.getPairReserves(tokenIn, tokenOut);

      // Determine which reserve corresponds to which token
      const isToken0In =
        reserves.token0.toLowerCase() === tokenIn.address.toLowerCase();
      const reserveIn = isToken0In ? reserves.reserve0 : reserves.reserve1;
      const reserveOut = isToken0In ? reserves.reserve1 : reserves.reserve0;

      // Convert to BigInt for precise calculations
      const amountInWei = ethers.parseUnits(amountIn, tokenIn.decimals);
      const reserveInBig = BigInt(reserveIn);
      const reserveOutBig = BigInt(reserveOut);

      // PancakeSwap V2 AMM formula: amountOut = (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
      // 997/1000 accounts for the 0.3% fee
      const amountInWithFee = amountInWei * 997n;
      const numerator = amountInWithFee * reserveOutBig;
      const denominator = reserveInBig * 1000n + amountInWithFee;
      const amountOutWei = numerator / denominator;

      const amountOut = ethers.formatUnits(amountOutWei, tokenOut.decimals);

      // Calculate price impact
      const spotPrice =
        Number(ethers.formatUnits(reserveOutBig, tokenOut.decimals)) /
        Number(ethers.formatUnits(reserveInBig, tokenIn.decimals));
      const effectivePrice = parseFloat(amountOut) / parseFloat(amountIn);
      const priceImpact = ((spotPrice - effectivePrice) / spotPrice) * 100;

      return {
        amountOut,
        priceImpact: priceImpact.toFixed(4),
        effectivePrice: effectivePrice.toFixed(8),
      };
    } catch (error) {
      throw new PancakeSwapError(
        `Failed to calculate swap amount: ${error instanceof Error ? error.message : String(error)}`,
        'SWAP_CALCULATION_FAILED',
        undefined,
        { tokenIn: tokenIn.symbol, tokenOut: tokenOut.symbol, amountIn },
      );
    }
  }

  /**
   * Calculate detailed liquidity information and optimal trade size
   */
  async calculateDetailedLiquidity(
    tokenA: { address: string; decimals: number },
    tokenB: { address: string; decimals: number },
    tradeAmountUsd: number,
  ): Promise<{
    reserves: { tokenA: bigint; tokenB: bigint };
    totalLiquidityUsd: number;
    priceImpact: number;
    maxTradeSize: number;
    slippageAtAmount: number;
  }> {
    try {
      const tokenAInfo: TokenInfo = {
        symbol: 'TOKENA',
        address: tokenA.address,
        decimals: tokenA.decimals,
      };
      const tokenBInfo: TokenInfo = {
        symbol: 'TOKENB',
        address: tokenB.address,
        decimals: tokenB.decimals,
      };

      const reserves = await this.getPairReserves(tokenAInfo, tokenBInfo);

      // Determine which reserve corresponds to which token
      const reserveA =
        tokenA.address.toLowerCase() === reserves.token0.toLowerCase()
          ? BigInt(reserves.reserve0)
          : BigInt(reserves.reserve1);
      const reserveB =
        tokenA.address.toLowerCase() === reserves.token0.toLowerCase()
          ? BigInt(reserves.reserve1)
          : BigInt(reserves.reserve0);

      // Calculate current price
      const currentPrice = Number(reserveB) / Number(reserveA);

      // Calculate total liquidity in USD (approximate)
      const tokenBReserveUsd =
        (Number(reserveB) / Math.pow(10, tokenB.decimals)) * 1; // Assuming tokenB is USDT
      const totalLiquidityUsd = tokenBReserveUsd * 2; // Total liquidity is 2x one side

      // Calculate trade amount in token A
      const tradeAmountTokenA =
        (tradeAmountUsd / currentPrice) * Math.pow(10, tokenA.decimals);

      // Calculate price impact using AMM formula
      const priceImpact = this.calculateAMMPriceImpact(
        reserveA,
        reserveB,
        BigInt(Math.floor(tradeAmountTokenA)),
      );

      // Calculate maximum trade size (keep price impact under 5%)
      const maxTradeSize = await this.calculateMaxTradeSize(
        reserveA,
        reserveB,
        tokenA.decimals,
        currentPrice,
      );

      // Calculate slippage for the specific trade amount
      const slippageAtAmount = this.calculateSlippageForAmount(
        reserveA,
        reserveB,
        BigInt(Math.floor(tradeAmountTokenA)),
      );

      return {
        reserves: { tokenA: reserveA, tokenB: reserveB },
        totalLiquidityUsd,
        priceImpact,
        maxTradeSize,
        slippageAtAmount,
      };
    } catch (error) {
      this.loggingService.error(
        'Failed to calculate detailed liquidity',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /**
   * Calculate price impact for a given trade amount using AMM formula
   */
  private calculateAMMPriceImpact(
    reserveA: bigint,
    reserveB: bigint,
    tradeAmount: bigint,
  ): number {
    // AMM formula: (reserveB * tradeAmount) / (reserveA + tradeAmount)
    const outputAmount = (reserveB * tradeAmount) / (reserveA + tradeAmount);
    const currentPrice = Number(reserveB) / Number(reserveA);
    const tradePrice = Number(outputAmount) / Number(tradeAmount);

    return Math.abs((tradePrice - currentPrice) / currentPrice) * 100;
  }

  /**
   * Calculate maximum trade size to keep price impact under 5%
   */
  private async calculateMaxTradeSize(
    reserveA: bigint,
    reserveB: bigint,
    decimals: number,
    currentPrice: number,
  ): Promise<number> {
    const maxPriceImpact = 0.05; // 5%

    // Binary search for max trade size
    let low = 0;
    let high = Number(reserveA) / 10; // Start with 10% of reserve as upper bound
    let maxSize = 0;

    while (high - low > 1000) {
      // Precision threshold
      const mid = Math.floor((low + high) / 2);
      const impact = await this.calculateAMMPriceImpact(
        reserveA,
        reserveB,
        BigInt(mid),
      );

      if (impact <= maxPriceImpact * 100) {
        maxSize = mid;
        low = mid;
      } else {
        high = mid;
      }
    }

    // Convert to USD
    return (maxSize / Math.pow(10, decimals)) * currentPrice;
  }

  /**
   * Calculate slippage for a specific trade amount
   */
  private calculateSlippageForAmount(
    reserveA: bigint,
    reserveB: bigint,
    tradeAmount: bigint,
  ): number {
    // Calculate actual output amount with fees (0.25% for PancakeSwap)
    const fee = 997; // 0.3% fee = 997/1000
    const tradeAmountWithFee = (tradeAmount * BigInt(fee)) / BigInt(1000);

    const outputAmount =
      (reserveB * tradeAmountWithFee) / (reserveA + tradeAmountWithFee);
    const idealOutput = (reserveB * tradeAmount) / reserveA;

    return (Number(idealOutput - outputAmount) / Number(idealOutput)) * 100;
  }

  /**
   * Get optimal trade size based on liquidity and target profit
   */
  async getOptimalTradeSize(
    tokenA: { address: string; decimals: number },
    tokenB: { address: string; decimals: number },
    targetProfitPercent: number,
    maxSlippage: number = 2,
  ): Promise<{
    optimalSizeUsd: number;
    expectedSlippage: number;
    priceImpact: number;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  }> {
    try {
      const liquidityData = await this.calculateDetailedLiquidity(
        tokenA,
        tokenB,
        1000, // $1000 test amount
      );

      // Start with conservative size
      const optimalSize = 100; // $100
      let bestSize = optimalSize;
      let bestConfidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';

      // Test different trade sizes
      for (
        let testSize = 100;
        testSize <= liquidityData.maxTradeSize;
        testSize += 100
      ) {
        const testData = await this.calculateDetailedLiquidity(
          tokenA,
          tokenB,
          testSize,
        );

        if (testData.slippageAtAmount <= maxSlippage) {
          const expectedProfit =
            targetProfitPercent - testData.slippageAtAmount;

          if (expectedProfit > 0) {
            bestSize = testSize;

            // Set confidence based on slippage and liquidity
            if (
              testData.slippageAtAmount < 0.5 &&
              testData.totalLiquidityUsd > 50000
            ) {
              bestConfidence = 'HIGH';
            } else if (
              testData.slippageAtAmount < 1 &&
              testData.totalLiquidityUsd > 20000
            ) {
              bestConfidence = 'MEDIUM';
            } else {
              bestConfidence = 'LOW';
            }
          }
        }
      }

      // Get final data for optimal size
      const finalData = await this.calculateDetailedLiquidity(
        tokenA,
        tokenB,
        bestSize,
      );

      return {
        optimalSizeUsd: bestSize,
        expectedSlippage: finalData.slippageAtAmount,
        priceImpact: finalData.priceImpact,
        confidence: bestConfidence,
      };
    } catch (error) {
      this.loggingService.error(
        'Failed to calculate optimal trade size',
        error instanceof Error ? error.message : String(error),
      );
      return {
        optimalSizeUsd: 100,
        expectedSlippage: 2,
        priceImpact: 1,
        confidence: 'LOW',
      };
    }
  }

  // 🔧 TEST METHOD: Verifică funcționarea router-ului cu token-uri reale
  async testRouterWithRealTokens(): Promise<any> {
    try {
      // Testez cu WBNB/USDT - pair cunoscut să existe
      const wbnbToken: TokenInfo = {
        address: BSC_TOKENS.WBNB.address,
        symbol: 'WBNB',
        decimals: 18,
        name: 'Wrapped BNB',
      };

      const usdtToken: TokenInfo = {
        address: BSC_TOKENS.USDT.address,
        symbol: 'USDT',
        decimals: 18,
        name: 'Tether USD',
      };

      const path = [wbnbToken.address, usdtToken.address];
      const amountIn = ethers.parseUnits('1', 18); // 1 WBNB

      this.loggingService.info('🧪 TESTING Router with WBNB/USDT', {
        component: 'PancakeSwapService',
        path,
        amountIn: amountIn.toString(),
      });

      const amounts = await this.getAmountsOut(amountIn.toString(), path);
      
      this.loggingService.info('✅ Router test SUCCESSFUL', {
        component: 'PancakeSwapService',
        amountIn: ethers.formatEther(amountIn),
        amountOut: ethers.formatUnits(amounts[1], 18),
        price: (parseFloat(ethers.formatUnits(amounts[1], 18)) / parseFloat(ethers.formatEther(amountIn))).toFixed(2),
      });

      return { success: true, amounts };
    } catch (error) {
      this.loggingService.error('❌ Router test FAILED', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Execută o tranzacție de vânzare pe PancakeSwap (SIMPLIFIED VERSION)
   * Bazată pe implementarea React funcțională
   */
  async sellILMTForUSDTSimplified(amount: number, minUsdtOut?: number): Promise<any> {
    try {
      // 1. Token configuration (exact ca în React)
      const ilmtToken = {
        address: '0x98a0a245Ef9A96Cf28f1Ebf1a3b3bC562Ed8D783',
        decimals: 18
      };
      
      const usdtToken = {
        address: '0x55d398326f99059fF775485246999027B3197955',
        decimals: 18
      };

      // 2. Path direct (fără routing prin WBNB)
      const path = [ilmtToken.address, usdtToken.address];

      // 3. Amount în wei
      const amountInWei = ethers.parseUnits(amount.toString(), ilmtToken.decimals);

      this.loggingService.info('🔄 SIMPLIFIED SWAP: Getting quote...', {
        component: 'PancakeSwapService',
        amountIn: amount,
        path,
        amountInWei: amountInWei.toString()
      });

      // 4. Get amounts out (exact ca în React)
      const amounts = await this.getAmountsOut(amountInWei.toString(), path);
      const amountOutWei = amounts[1];
      const amountOut = ethers.formatUnits(amountOutWei, usdtToken.decimals);

      this.loggingService.info('✅ SIMPLIFIED SWAP: Quote successful', {
        component: 'PancakeSwapService',
        amountIn: amount,
        amountOut: parseFloat(amountOut),
        exchangeRate: (parseFloat(amountOut) / amount).toFixed(6)
      });

      // 5. În TEST_MODE, returnăm doar quote-ul
      if (process.env.TEST_MODE === 'true') {
        return {
          success: true,
          testMode: true,
          quote: {
            amountIn: amount,
            amountOut: parseFloat(amountOut),
            exchangeRate: (parseFloat(amountOut) / amount).toFixed(6),
            path
          }
        };
      }

      // 6. Pentru REAL TRADING - execută swap-ul efectiv
      this.loggingService.info('🚀 EXECUTING REAL SWAP...', {
        component: 'PancakeSwapService',
        amountIn: amount,
        expectedAmountOut: parseFloat(amountOut),
        mode: 'REAL_TRADING'
      });

      // 6.1 Ensure token approval
      await this.ensureTokenApproval(ilmtToken.address, amountInWei.toString());

      // 6.2 Execute the actual swap
      const router = this.blockchainService.getRouterContract();
      const wallet = this.blockchainService.getWallet();
      const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 minutes

      // Calculate minimum amount out with enhanced slippage protection
      const slippagePercent = minUsdtOut ? 0 : 5; // Increased to 5% for volatile tokens
      const minimumAmountOut = parseFloat(amountOut) * (1 - slippagePercent / 100);
      const minimumAmountOutWei = ethers.parseUnits(minimumAmountOut.toString(), usdtToken.decimals);
      
      this.loggingService.info('🎯 Slippage protection enhanced:', {
        component: 'PancakeSwapService',
        expectedAmountOut: parseFloat(amountOut),
        minimumAmountOut: minimumAmountOut,
        slippagePercent: slippagePercent,
        protection: 'Prevents slippage-related failures'
      });

      // 📊 ENHANCED GAS SETTINGS for BSC (Fixed for transaction failures)
      const gasSettings = await this.calculateOptimizedGasSettings('swap');
      
      // Ensure minimum gas price for BSC (prevent transaction failures)
      const minGasPrice = 3; // 3 gwei minimum for BSC
      const safeGasPrice = Math.max(parseFloat(gasSettings.gasPrice), minGasPrice);
      const safeGasLimit = Math.max(gasSettings.gasLimit, 150000); // Minimum 150k gas limit
      
      // Calculate potential savings
      const oldGasCost = (300000 * 5 * 1e-9); // Old: 300k gasLimit * 5 gwei
      const newGasCost = (safeGasLimit * safeGasPrice * 1e-9);
      const savingsPercent = ((oldGasCost - newGasCost) / oldGasCost * 100).toFixed(1);
      
      this.loggingService.info('💰 ENHANCED Gas settings (failure-resistant):', {
        component: 'PancakeSwapService',
        oldCost: `${oldGasCost.toFixed(6)} BNB`,
        newCost: `${newGasCost.toFixed(6)} BNB`,
        savings: `${savingsPercent}%`,
        gasLimit: safeGasLimit,
        gasPrice: `${safeGasPrice} gwei`,
        minGasPrice: `${minGasPrice} gwei (BSC minimum)`,
        enhancement: 'Prevents transaction failures'
      });
      
      // 📝 LOG TRANSACTION BEFORE EXECUTION
      this.logOnChainTransaction({
        type: 'SWAP',
        from: wallet.address,
        to: PANCAKESWAP_CONTRACTS.ROUTER_V2,
        tokenIn: {
          symbol: 'ILMT',
          address: ilmtToken.address,
          amount: amount.toString(),
          decimals: ilmtToken.decimals,
        },
        tokenOut: {
          symbol: 'USDT',
          address: usdtToken.address,
          amount: parseFloat(amountOut).toString(),
          decimals: usdtToken.decimals,
        },
        gasLimit: gasSettings.gasLimit.toString(),
        gasPrice: gasSettings.gasPrice,
        exchange: 'PANCAKESWAP',
        slippage: slippagePercent,
        priceImpact: '0', // Calculated later if needed
      });

      const tx = await router.swapExactTokensForTokens(
        amountInWei,
        minimumAmountOutWei,
        path,
        wallet.address,
        deadline,
        {
          gasLimit: safeGasLimit,
          gasPrice: ethers.parseUnits(safeGasPrice.toString(), 'gwei')
        }
      );

      this.loggingService.info('💫 REAL SWAP TRANSACTION SENT', {
        component: 'PancakeSwapService',
        txHash: tx.hash,
        amountIn: amount,
        minimumAmountOut: minimumAmountOut
      });

      // Wait for transaction confirmation
      const receipt = await tx.wait();

      this.loggingService.info('✅ REAL SWAP CONFIRMED!', {
        component: 'PancakeSwapService',
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        status: receipt.status === 1 ? 'SUCCESS' : 'FAILED'
      });

      return {
        success: receipt.status === 1,
        realTrade: true,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        quote: {
          amountIn: amount,
          amountOut: parseFloat(amountOut),
          exchangeRate: (parseFloat(amountOut) / amount).toFixed(6),
          path
        }
      };

    } catch (error) {
      this.loggingService.error('❌ SIMPLIFIED SWAP failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Execută o tranzacție de vânzare pe PancakeSwap
   * Vinde ILMT pentru USDT
   */
  async sellILMTForUSDT(amount: number, minUsdtOut?: number): Promise<any> {
    try {
      const ilmtToken: TokenInfo = {
        address: process.env.ILMT_TOKEN_ADDRESS || '0x98a0a245ef9a96cf28f1ebf1a3b3bc562ed8d783',
        symbol: 'ILMT',
        decimals: 18,
        name: 'ILMT Token',
      };

      const usdtToken: TokenInfo = {
        address: BSC_TOKENS.USDT.address,
        symbol: 'USDT',
        decimals: 18,
        name: 'Tether USD',
      };

      // Verifică dacă avem tokens definiti
      if (!ilmtToken.address) {
        throw new Error('ILMT token address not configured');
      }

      // Calculează minimum USDT out cu 2% slippage dacă nu e specificat
      const slippage = minUsdtOut ? 0 : 2;

      const result = await this.swapExactTokensForTokens(
        ilmtToken,
        usdtToken,
        amount.toString(),
        slippage,
      );

      this.loggingService.info(
        `🥞 PANCAKESWAP SELL EXECUTED: ${amount} ILMT → USDT`,
        {
          component: 'PancakeSwapService',
          txHash: result.transactionHash,
          amount,
          amountOut: result.amountOut,
          gasUsed: result.gasUsed,
          blockNumber: result.blockNumber,
        },
      );

      return result;
    } catch (error) {
      this.loggingService.error(
        'Failed to sell ILMT on PancakeSwap',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /**
   * 📊 OPTIMIZED GAS CALCULATOR for BSC
   * Returnează cele mai bune setări de gas pentru a minimiza costurile
   */
  private async calculateOptimizedGasSettings(transactionType: 'swap' | 'approve' = 'swap'): Promise<{
    gasLimit: number;
    gasPrice: string;
    estimatedCost: string;
  }> {
    try {
      // Get current network gas price
      const currentGasPrice = await this.blockchainService.getGasPrice();
      const currentGasPriceNum = parseFloat(currentGasPrice);
      
      // BSC optimal gas prices (much lower than Ethereum)
      const optimizedGasPrice = Math.min(currentGasPriceNum, 3); // Max 3 gwei for BSC
      
      // Conservative gas limits (reduced from previous values)
      const gasLimits = {
        swap: 120000,     // Was 300k, now 120k
        approve: 45000,   // Was 50k, now 45k
      };
      
      const gasLimit = gasLimits[transactionType];
      const estimatedCost = (gasLimit * optimizedGasPrice * 1e-9).toFixed(6); // BNB cost
      
      this.loggingService.info(`📊 Gas optimization for ${transactionType}:`, {
        component: 'PancakeSwapService',
        transactionType,
        gasLimit,
        gasPrice: `${optimizedGasPrice} gwei`,
        estimatedCost: `${estimatedCost} BNB`,
        savings: `${((300000 - gasLimit) / 300000 * 100).toFixed(1)}% gas limit reduction`
      });
      
      return {
        gasLimit,
        gasPrice: optimizedGasPrice.toString(),
        estimatedCost
      };
      
    } catch (error) {
      this.loggingService.error('Gas optimization failed, using fallback', error instanceof Error ? error.message : String(error));
      
      // Fallback to safe defaults
      return {
        gasLimit: transactionType === 'swap' ? 150000 : 50000,
        gasPrice: '3',
        estimatedCost: '0.0005' // Approximate fallback
      };
    }
  }

  /**
   * 📝 ON-CHAIN TRANSACTION LOGGER
   * Înregistrează toate tranzacțiile on-chain într-un fișier de log dedicat
   */
  private logOnChainTransaction(transaction: {
    type: 'SWAP' | 'APPROVAL';
    hash?: string;
    from: string;
    to: string;
    tokenIn?: {
      symbol: string;
      address: string;
      amount: string;
      decimals: number;
    };
    tokenOut?: {
      symbol: string;
      address: string;
      amount: string;
      decimals: number;
    };
    gasLimit: string;
    gasPrice: string;
    exchange?: 'PANCAKESWAP';
    slippage?: number;
    priceImpact?: string;
  }): void {
    const logDir = join(process.cwd(), 'logs');
    const logFile = join(logDir, 'on-chain-transactions.log');
    
    // Ensure log directory exists
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
    
    // Initialize log file if it doesn't exist
    if (!existsSync(logFile)) {
      const header = `# ON-CHAIN TRANSACTION LOG
# Started: ${new Date().toISOString()}
# Format: JSON per line
# ===========================================

`;
      writeFileSync(logFile, header);
    }
    
    // Create log entry
    const logEntry = {
      id: `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      status: transaction.hash ? 'INITIATED' : 'PENDING',
      ...transaction,
      gasCostEstimate: transaction.gasLimit && transaction.gasPrice 
        ? `${(parseInt(transaction.gasLimit) * parseFloat(transaction.gasPrice) * 1e-9).toFixed(6)} BNB`
        : 'N/A',
    };
    
    // Append to log file
    try {
      appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
    } catch (error) {
      this.loggingService.error('Failed to write transaction log', error instanceof Error ? error.message : String(error));
    }
    
    // Console logging
    this.loggingService.info(`📝 ON-CHAIN TX LOGGED: ${transaction.type}`, {
      component: 'PancakeSwapService',
      txId: logEntry.id,
      hash: transaction.hash,
      type: transaction.type,
      tokenIn: transaction.tokenIn?.symbol,
      tokenOut: transaction.tokenOut?.symbol,
      gasCostEstimate: logEntry.gasCostEstimate,
      exchange: transaction.exchange,
      priceImpact: transaction.priceImpact,
    });
  }
}
