import { Injectable } from '@nestjs/common';
import { LoggingService } from '../../logging/logging.service';
import { ConfigService } from '@nestjs/config';
import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface OnChainTransaction {
  id: string;
  timestamp: Date;
  type: 'SWAP' | 'APPROVAL' | 'TRANSFER';
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  
  // Basic transaction data
  hash?: string;
  blockNumber?: number;
  from: string;
  to: string;
  value?: string;
  
  // Gas information
  gasLimit: string;
  gasUsed?: string;
  gasPrice: string;
  gasCost?: string; // in BNB
  gasCostUSD?: string;
  
  // Swap specific data
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
  
  // DEX information
  exchange?: 'PANCAKESWAP' | 'MEXC';
  router?: string;
  path?: string[];
  slippage?: number;
  
  // Financial data
  inputValueUSD?: string;
  outputValueUSD?: string;
  priceImpact?: string;
  
  // Arbitrage context
  strategy?: string;
  opportunityId?: string;
  expectedProfit?: string;
  actualProfit?: string;
  
  // Error information
  error?: string;
  failureReason?: string;
  
  // Confirmation data
  confirmations?: number;
  confirmedAt?: Date;
}

@Injectable()
export class TransactionLoggerService {
  private readonly logDir: string;
  private readonly transactionLogFile: string;
  private readonly transactionHistory: OnChainTransaction[] = [];

  constructor(
    private readonly loggingService: LoggingService,
    private readonly configService: ConfigService,
  ) {
    this.logDir = join(process.cwd(), 'logs');
    this.transactionLogFile = join(this.logDir, 'on-chain-transactions.log');
    this.initializeLogFile();
  }

  private initializeLogFile(): void {
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }

    if (!existsSync(this.transactionLogFile)) {
      const header = `# ON-CHAIN TRANSACTION LOG
# Started: ${new Date().toISOString()}
# Format: JSON per line
# ===========================================

`;
      writeFileSync(this.transactionLogFile, header);
    }
  }

  /**
   * 📝 Log a new transaction (when initiated)
   */
  logTransactionInitiated(transaction: Partial<OnChainTransaction>): string {
    const txId = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const fullTransaction: OnChainTransaction = {
      id: txId,
      timestamp: new Date(),
      status: 'PENDING',
      type: transaction.type || 'SWAP',
      gasLimit: transaction.gasLimit || '150000',
      gasPrice: transaction.gasPrice || '3',
      from: transaction.from || 'unknown',
      to: transaction.to || 'unknown',
      ...transaction,
    };

    // Add to memory
    this.transactionHistory.push(fullTransaction);

    // Log to file
    this.writeTransactionToFile(fullTransaction);

    // Log to console
    this.loggingService.info(`📝 ON-CHAIN TX INITIATED: ${fullTransaction.type}`, {
      component: 'TransactionLoggerService',
      txId,
      type: fullTransaction.type,
      from: fullTransaction.from,
      to: fullTransaction.to,
      gasLimit: fullTransaction.gasLimit,
      gasPrice: fullTransaction.gasPrice,
      tokenIn: fullTransaction.tokenIn?.symbol,
      tokenOut: fullTransaction.tokenOut?.symbol,
      exchange: fullTransaction.exchange,
    });

    return txId;
  }

  /**
   * ✅ Update transaction when confirmed
   */
  updateTransactionConfirmed(txId: string, data: Partial<OnChainTransaction>): void {
    const transaction = this.findTransaction(txId);
    if (!transaction) {
      this.loggingService.error(`Transaction not found: ${txId}`, 'TransactionLoggerService');
      return;
    }

    // Update transaction data
    Object.assign(transaction, {
      ...data,
      status: 'CONFIRMED',
      confirmedAt: new Date(),
    });

    // Log to file
    this.writeTransactionToFile(transaction);

    // Calculate actual costs and profits
    const gasCostBNB = this.calculateGasCost(transaction);
    const actualProfit = this.calculateActualProfit(transaction);

    // Log to console
    this.loggingService.info(`✅ ON-CHAIN TX CONFIRMED: ${transaction.hash}`, {
      component: 'TransactionLoggerService',
      txId,
      hash: transaction.hash,
      blockNumber: transaction.blockNumber,
      gasUsed: transaction.gasUsed,
      gasCost: `${gasCostBNB} BNB`,
      gasCostUSD: transaction.gasCostUSD,
      actualProfit,
      tokenIn: transaction.tokenIn ? `${transaction.tokenIn.amount} ${transaction.tokenIn.symbol}` : null,
      tokenOut: transaction.tokenOut ? `${transaction.tokenOut.amount} ${transaction.tokenOut.symbol}` : null,
      priceImpact: transaction.priceImpact,
      confirmations: transaction.confirmations,
    });

    // Log profitability analysis
    this.logProfitabilityAnalysis(transaction);
  }

  /**
   * ❌ Update transaction when failed
   */
  updateTransactionFailed(txId: string, error: string, failureReason?: string): void {
    const transaction = this.findTransaction(txId);
    if (!transaction) {
      this.loggingService.error(`Transaction not found: ${txId}`, 'TransactionLoggerService');
      return;
    }

    // Update transaction data
    Object.assign(transaction, {
      status: 'FAILED',
      error,
      failureReason,
      confirmedAt: new Date(),
    });

    // Log to file
    this.writeTransactionToFile(transaction);

    // Log to console
    this.loggingService.error(
      `❌ ON-CHAIN TX FAILED: ${txId} - ${error}`,
      `Type: ${transaction.type}, Gas: ${transaction.gasLimit}@${transaction.gasPrice}gwei, TokenIn: ${transaction.tokenIn?.symbol}, TokenOut: ${transaction.tokenOut?.symbol}, Reason: ${failureReason}`
    );
  }

  /**
   * 📊 Log profitability analysis
   */
  private logProfitabilityAnalysis(transaction: OnChainTransaction): void {
    if (transaction.type !== 'SWAP' || !transaction.expectedProfit) return;

    const expectedProfit = parseFloat(transaction.expectedProfit || '0');
    const actualProfit = parseFloat(transaction.actualProfit || '0');
    const gasCost = parseFloat(transaction.gasCost || '0');
    const netProfit = actualProfit - gasCost;

    const profitDifference = actualProfit - expectedProfit;
    const profitDifferencePercent = expectedProfit > 0 ? (profitDifference / expectedProfit) * 100 : 0;

    this.loggingService.info(`📊 PROFITABILITY ANALYSIS: ${transaction.id}`, {
      component: 'TransactionLoggerService',
      txId: transaction.id,
      hash: transaction.hash,
      expectedProfit: `${expectedProfit.toFixed(6)} BNB`,
      actualProfit: `${actualProfit.toFixed(6)} BNB`,
      gasCost: `${gasCost.toFixed(6)} BNB`,
      netProfit: `${netProfit.toFixed(6)} BNB`,
      profitDifference: `${profitDifference.toFixed(6)} BNB`,
      profitDifferencePercent: `${profitDifferencePercent.toFixed(2)}%`,
      isProfitable: netProfit > 0,
      exchange: transaction.exchange,
      strategy: transaction.strategy,
    });
  }

  /**
   * 💰 Calculate actual gas cost in BNB
   */
  private calculateGasCost(transaction: OnChainTransaction): string {
    if (!transaction.gasUsed || !transaction.gasPrice) return '0';
    
    const gasUsed = parseInt(transaction.gasUsed);
    const gasPrice = parseFloat(transaction.gasPrice);
    const gasCostBNB = (gasUsed * gasPrice * 1e-9).toFixed(6);
    
    return gasCostBNB;
  }

  /**
   * 📈 Calculate actual profit
   */
  private calculateActualProfit(transaction: OnChainTransaction): string {
    if (!transaction.outputValueUSD || !transaction.inputValueUSD) return '0';
    
    const outputValue = parseFloat(transaction.outputValueUSD);
    const inputValue = parseFloat(transaction.inputValueUSD);
    const profit = outputValue - inputValue;
    
    return profit.toFixed(6);
  }

  /**
   * 🔍 Find transaction by ID
   */
  private findTransaction(txId: string): OnChainTransaction | undefined {
    return this.transactionHistory.find(tx => tx.id === txId);
  }

  /**
   * 📄 Write transaction to log file
   */
  private writeTransactionToFile(transaction: OnChainTransaction): void {
    const logEntry = {
      ...transaction,
      timestamp: transaction.timestamp.toISOString(),
      confirmedAt: transaction.confirmedAt?.toISOString(),
    };

    const logLine = JSON.stringify(logEntry) + '\n';
    
    try {
      appendFileSync(this.transactionLogFile, logLine);
    } catch (error) {
      this.loggingService.error('Failed to write transaction to log file', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 📋 Get transaction history
   */
  getTransactionHistory(limit: number = 100): OnChainTransaction[] {
    return this.transactionHistory
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * 📊 Get transaction statistics
   */
  getTransactionStats(): {
    total: number;
    confirmed: number;
    failed: number;
    pending: number;
    totalGasCost: string;
    totalProfit: string;
    successRate: string;
  } {
    const total = this.transactionHistory.length;
    const confirmed = this.transactionHistory.filter(tx => tx.status === 'CONFIRMED').length;
    const failed = this.transactionHistory.filter(tx => tx.status === 'FAILED').length;
    const pending = this.transactionHistory.filter(tx => tx.status === 'PENDING').length;

    const totalGasCost = this.transactionHistory
      .filter(tx => tx.gasCost)
      .reduce((sum, tx) => sum + parseFloat(tx.gasCost!), 0);

    const totalProfit = this.transactionHistory
      .filter(tx => tx.actualProfit)
      .reduce((sum, tx) => sum + parseFloat(tx.actualProfit!), 0);

    const successRate = total > 0 ? (confirmed / total * 100).toFixed(2) : '0';

    return {
      total,
      confirmed,
      failed,
      pending,
      totalGasCost: totalGasCost.toFixed(6),
      totalProfit: totalProfit.toFixed(6),
      successRate,
    };
  }

  /**
   * 📊 Log hourly statistics
   */
  logHourlyStats(): void {
    const stats = this.getTransactionStats();
    
    this.loggingService.info('📊 HOURLY ON-CHAIN TRANSACTION STATS', {
      component: 'TransactionLoggerService',
      period: 'HOURLY',
      stats,
    });
  }
} 