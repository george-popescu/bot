import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LoggingService } from '../../logging/logging.service';
import { MexcApiService } from '../../mexc/services/mexc-api.service';
import { PancakeSwapService } from '../../pancakeswap/services/pancakeswap.service';
import { BlockchainService } from '../../pancakeswap/services/blockchain.service';
import {
  ArbitrageOpportunity,
  ArbitrageTrade,
  InsufficientBalanceError,
  ExecutionTimeoutError,
  ArbitrageError,
} from '../types/arbitrage.types';
import { BSC_TOKENS } from '../../pancakeswap/types/pancakeswap.types';
import { formatMexcQuantity } from '../../mexc/utils/mexc-formatting.utils';

@Injectable()
export class ArbitrageExecutorService {
  private activeTrades = new Map<string, ArbitrageTrade>();
  private executionQueue: ArbitrageOpportunity[] = [];
  private isExecuting = false;

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly loggingService: LoggingService,
    private readonly mexcApiService: MexcApiService,
    private readonly pancakeSwapService: PancakeSwapService,
    private readonly blockchainService: BlockchainService,
  ) {}

  async executeArbitrage(
    opportunity: ArbitrageOpportunity,
    amount: number,
  ): Promise<ArbitrageTrade> {
    const trade: ArbitrageTrade = {
      id: `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      opportunityId: opportunity.id,
      symbol: opportunity.symbol,
      amount,
      status: 'PENDING',
      totalProfit: 0,
      totalFees: 0,
      netProfit: 0,
      executionTime: 0,
      createdAt: new Date(),
    };

    this.activeTrades.set(trade.id, trade);
    this.eventEmitter.emit('trade.started', trade);

    this.loggingService.info('Starting arbitrage execution', {
      component: 'ArbitrageExecutorService',
      tradeId: trade.id,
      opportunityId: opportunity.id,
      direction: `${opportunity.buyExchange} -> ${opportunity.sellExchange}`,
      amount,
    });

    try {
      // Validate balances before execution
      await this.validateBalances(opportunity, amount);

      // Update trade status
      trade.status = 'EXECUTING';
      this.activeTrades.set(trade.id, trade);

      const startTime = Date.now();

      // Execute trades based on direction
      if (
        opportunity.buyExchange === 'MEXC' &&
        opportunity.sellExchange === 'PANCAKESWAP'
      ) {
        await this.executeMexcToPancakeSwap(trade, opportunity, amount);
      } else if (
        opportunity.buyExchange === 'PANCAKESWAP' &&
        opportunity.sellExchange === 'MEXC'
      ) {
        await this.executePancakeSwapToMexc(trade, opportunity, amount);
      } else {
        throw new ArbitrageError(
          'Invalid arbitrage direction',
          'INVALID_DIRECTION',
        );
      }

      // Calculate final metrics
      trade.executionTime = Date.now() - startTime;
      trade.status = 'COMPLETED';
      trade.completedAt = new Date();

      this.calculateTradeProfits(trade);

      this.activeTrades.set(trade.id, trade);
      this.eventEmitter.emit('trade.completed', trade);

      this.loggingService.info('Arbitrage execution completed', {
        component: 'ArbitrageExecutorService',
        tradeId: trade.id,
        executionTime: trade.executionTime,
        netProfit: trade.netProfit,
        netProfitPercentage: (trade.netProfit / amount) * 100,
      });

      return trade;
    } catch (error) {
      trade.status = 'FAILED';
      trade.error = error instanceof Error ? error.message : String(error);
      trade.completedAt = new Date();

      this.activeTrades.set(trade.id, trade);
      this.eventEmitter.emit('trade.failed', { trade, error: trade.error });

      this.loggingService.info('Arbitrage execution failed', {
        component: 'ArbitrageExecutorService',
        tradeId: trade.id,
        error: trade.error,
      });

      throw error;
    }
  }

  private async executeMexcToPancakeSwap(
    trade: ArbitrageTrade,
    opportunity: ArbitrageOpportunity,
    amount: number,
  ): Promise<void> {
    // Step 1: Buy ILMT on MEXC with USDT
    this.loggingService.info('Executing MEXC buy order', {
      component: 'ArbitrageExecutorService',
      tradeId: trade.id,
      amount,
      price: opportunity.buyPrice,
    });

    const mexcOrderRequest = {
      symbol: opportunity.symbol,
      side: 'BUY' as const,
      type: 'MARKET' as const,
      quantity: formatMexcQuantity(amount / opportunity.buyPrice),
    };

    const mexcOrder = await this.mexcApiService.placeOrder(mexcOrderRequest);

    trade.mexcTrade = {
      side: 'BUY',
      orderId: mexcOrder.orderId,
      price: parseFloat(mexcOrder.price || opportunity.buyPrice.toString()),
      amount: parseFloat(mexcOrder.origQty),
      status: mexcOrder.status,
      executedAt: new Date(),
      fee: parseFloat(mexcOrder.origQty) * 0.002, // 0.2% MEXC fee
    };

    // Wait for MEXC order to be filled
    await this.waitForMexcOrderFill(trade.mexcTrade.orderId!, 30000);

    // Step 2: Transfer ILMT to PancakeSwap wallet (if needed)
    // This would involve withdrawing from MEXC to the wallet, but for this implementation
    // we'll assume the tokens are already available

    // Step 3: Sell ILMT on PancakeSwap for USDT
    this.loggingService.info('Executing PancakeSwap sell order', {
      component: 'ArbitrageExecutorService',
      tradeId: trade.id,
      amount: trade.mexcTrade.amount,
      expectedPrice: opportunity.sellPrice,
    });

    const ilmtToken = {
      symbol: 'ILMT',
      address: '0x0000000000000000000000000000000000000000', // Would be configured
      decimals: 18,
      name: 'ILMT Token',
    };

    const swapResult = await this.pancakeSwapService.swapExactTokensForTokens(
      ilmtToken,
      BSC_TOKENS.USDT,
      trade.mexcTrade.amount.toString(),
      0.5, // 0.5% slippage
    );

    trade.pancakeswapTrade = {
      side: 'SELL',
      transactionHash: swapResult.transactionHash,
      price: parseFloat(swapResult.amountOut) / parseFloat(swapResult.amountIn),
      amount: parseFloat(swapResult.amountIn),
      status: swapResult.success ? 'FILLED' : 'FAILED',
      executedAt: swapResult.timestamp,
      gasUsed: parseInt(swapResult.gasUsed),
      gasCost:
        (parseFloat(swapResult.effectiveGasPrice) *
          parseInt(swapResult.gasUsed)) /
        1e18,
      fee: parseFloat(swapResult.amountIn) * 0.0025, // 0.25% PancakeSwap fee
    };

    if (!swapResult.success) {
      throw new ArbitrageError(
        'PancakeSwap transaction failed',
        'PANCAKESWAP_FAILED',
      );
    }
  }

  private async executePancakeSwapToMexc(
    trade: ArbitrageTrade,
    opportunity: ArbitrageOpportunity,
    amount: number,
  ): Promise<void> {
    // Step 1: Buy ILMT on PancakeSwap with USDT
    this.loggingService.info('Executing PancakeSwap buy order', {
      component: 'ArbitrageExecutorService',
      tradeId: trade.id,
      amount,
      expectedPrice: opportunity.buyPrice,
    });

    const ilmtToken = {
      symbol: 'ILMT',
      address: '0x0000000000000000000000000000000000000000', // Would be configured
      decimals: 18,
      name: 'ILMT Token',
    };

    const swapResult = await this.pancakeSwapService.swapExactTokensForTokens(
      BSC_TOKENS.USDT,
      ilmtToken,
      amount.toString(),
      0.5, // 0.5% slippage
    );

    trade.pancakeswapTrade = {
      side: 'BUY',
      transactionHash: swapResult.transactionHash,
      price: parseFloat(swapResult.amountIn) / parseFloat(swapResult.amountOut),
      amount: parseFloat(swapResult.amountOut),
      status: swapResult.success ? 'FILLED' : 'FAILED',
      executedAt: swapResult.timestamp,
      gasUsed: parseInt(swapResult.gasUsed),
      gasCost:
        (parseFloat(swapResult.effectiveGasPrice) *
          parseInt(swapResult.gasUsed)) /
        1e18,
      fee: parseFloat(swapResult.amountIn) * 0.0025, // 0.25% PancakeSwap fee
    };

    if (!swapResult.success) {
      throw new ArbitrageError(
        'PancakeSwap transaction failed',
        'PANCAKESWAP_FAILED',
      );
    }

    // Step 2: Transfer ILMT to MEXC (would involve deposit to MEXC)
    // For this implementation, we'll assume tokens are already available

    // Step 3: Sell ILMT on MEXC for USDT
    this.loggingService.info('Executing MEXC sell order', {
      component: 'ArbitrageExecutorService',
      tradeId: trade.id,
      amount: trade.pancakeswapTrade.amount,
      price: opportunity.sellPrice,
    });

    const mexcOrderRequest = {
      symbol: opportunity.symbol,
      side: 'SELL' as const,
      type: 'MARKET' as const,
      quantity: formatMexcQuantity(trade.pancakeswapTrade.amount),
    };

    const mexcOrder = await this.mexcApiService.placeOrder(mexcOrderRequest);

    trade.mexcTrade = {
      side: 'SELL',
      orderId: mexcOrder.orderId,
      price: parseFloat(mexcOrder.price || opportunity.sellPrice.toString()),
      amount: parseFloat(mexcOrder.origQty),
      status: mexcOrder.status,
      executedAt: new Date(),
      fee: parseFloat(mexcOrder.origQty) * 0.002, // 0.2% MEXC fee
    };

    // Wait for MEXC order to be filled
    await this.waitForMexcOrderFill(trade.mexcTrade.orderId!, 30000);
  }

  private async waitForMexcOrderFill(
    orderId: number,
    timeoutMs: number,
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        const order = await this.mexcApiService.getOrder('ILMTUSDT', orderId);

        if (order.status === 'FILLED') {
          return;
        }

        if (order.status === 'CANCELED' || order.status === 'REJECTED') {
          throw new ArbitrageError(
            `MEXC order ${orderId} was ${order.status}`,
            'MEXC_ORDER_FAILED',
          );
        }

        // Wait 1 second before checking again
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        this.loggingService.info('Error checking MEXC order status', {
          component: 'ArbitrageExecutorService',
          orderId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    throw new ExecutionTimeoutError(`mexc_order_${orderId}`, timeoutMs);
  }

  private async validateBalances(
    opportunity: ArbitrageOpportunity,
    amount: number,
  ): Promise<void> {
    if (opportunity.buyExchange === 'MEXC') {
      // Need USDT on MEXC to buy ILMT
      const mexcAccount = await this.mexcApiService.getAccount();
      const usdtBalance = mexcAccount.balances.find((b) => b.asset === 'USDT');
      const availableUsdt = parseFloat(usdtBalance?.free || '0');

      if (availableUsdt < amount) {
        throw new InsufficientBalanceError(
          'MEXC',
          'USDT',
          amount,
          availableUsdt,
        );
      }
    } else {
      // Need USDT on PancakeSwap to buy ILMT
      const usdtBalance = await this.pancakeSwapService.getTokenBalance(
        BSC_TOKENS.USDT,
      );
      const availableUsdt = parseFloat(usdtBalance);

      if (availableUsdt < amount) {
        throw new InsufficientBalanceError(
          'PANCAKESWAP',
          'USDT',
          amount,
          availableUsdt,
        );
      }
    }

    // Check BNB balance for gas
    const bnbBalance = await this.pancakeSwapService.getBNBBalance();
    const availableBnb = parseFloat(bnbBalance);

    if (availableBnb < 0.01) {
      // Minimum 0.01 BNB for gas
      throw new InsufficientBalanceError(
        'PANCAKESWAP',
        'BNB',
        0.01,
        availableBnb,
      );
    }
  }

  private calculateTradeProfits(trade: ArbitrageTrade): void {
    let totalProfit = 0;
    let totalFees = 0;

    if (trade.mexcTrade) {
      if (trade.mexcTrade.side === 'BUY') {
        // Bought ILMT, profit is the value of ILMT received
        totalProfit += trade.mexcTrade.amount * trade.mexcTrade.price;
      } else {
        // Sold ILMT, profit is the USDT received
        totalProfit += trade.mexcTrade.amount * trade.mexcTrade.price;
      }
      totalFees += trade.mexcTrade.fee;
    }

    if (trade.pancakeswapTrade) {
      if (trade.pancakeswapTrade.side === 'BUY') {
        // Bought ILMT, cost is the USDT spent
        totalProfit -=
          trade.pancakeswapTrade.amount * trade.pancakeswapTrade.price;
      } else {
        // Sold ILMT, revenue is the USDT received
        totalProfit +=
          trade.pancakeswapTrade.amount * trade.pancakeswapTrade.price;
      }
      totalFees += trade.pancakeswapTrade.fee;
      if (trade.pancakeswapTrade.gasCost) {
        totalFees += trade.pancakeswapTrade.gasCost;
      }
    }

    // The profit calculation needs to account for the original investment
    const netProfit = totalProfit - trade.amount - totalFees;

    trade.totalProfit = totalProfit;
    trade.totalFees = totalFees;
    trade.netProfit = netProfit;
  }

  // Public methods
  getActiveTrades(): ArbitrageTrade[] {
    return Array.from(this.activeTrades.values());
  }

  getTrade(tradeId: string): ArbitrageTrade | undefined {
    return this.activeTrades.get(tradeId);
  }

  async cancelTrade(tradeId: string): Promise<boolean> {
    const trade = this.activeTrades.get(tradeId);

    if (!trade || trade.status !== 'EXECUTING') {
      return false;
    }

    try {
      // Cancel any pending MEXC orders
      if (trade.mexcTrade?.orderId && trade.mexcTrade.status !== 'FILLED') {
        await this.mexcApiService.cancelOrder(
          trade.symbol,
          trade.mexcTrade.orderId.toString(),
        );
      }

      trade.status = 'CANCELLED';
      trade.completedAt = new Date();
      trade.error = 'Cancelled by user';

      this.activeTrades.set(tradeId, trade);

      this.loggingService.info('Trade cancelled', {
        component: 'ArbitrageExecutorService',
        tradeId,
      });

      return true;
    } catch (error) {
      this.loggingService.info('Failed to cancel trade', {
        component: 'ArbitrageExecutorService',
        tradeId,
        error: error instanceof Error ? error.message : String(error),
      });

      return false;
    }
  }

  getExecutionMetrics(): {
    activeTrades: number;
    queuedOpportunities: number;
    isExecuting: boolean;
  } {
    return {
      activeTrades: this.activeTrades.size,
      queuedOpportunities: this.executionQueue.length,
      isExecuting: this.isExecuting,
    };
  }

  clearCompletedTrades(): void {
    const completedTradeIds: string[] = [];

    for (const [tradeId, trade] of this.activeTrades.entries()) {
      if (
        trade.status === 'COMPLETED' ||
        trade.status === 'FAILED' ||
        trade.status === 'CANCELLED'
      ) {
        completedTradeIds.push(tradeId);
      }
    }

    for (const tradeId of completedTradeIds) {
      this.activeTrades.delete(tradeId);
    }

    this.loggingService.info('Cleared completed trades', {
      component: 'ArbitrageExecutorService',
      clearedCount: completedTradeIds.length,
    });
  }
}
