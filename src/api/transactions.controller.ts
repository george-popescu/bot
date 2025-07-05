import { Controller, Get, Query } from '@nestjs/common';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface OnChainTransactionLog {
  id: string;
  timestamp: string;
  status: string;
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
  gasCostEstimate: string;
  exchange?: 'PANCAKESWAP';
  slippage?: number;
  priceImpact?: string;
}

@Controller('api/transactions')
export class TransactionsController {
  
  /**
   * 📋 Get on-chain transaction history
   */
  @Get()
  getTransactions(
    @Query('limit') limit?: string,
    @Query('type') type?: 'SWAP' | 'APPROVAL',
    @Query('status') status?: 'INITIATED' | 'PENDING' | 'CONFIRMED' | 'FAILED'
  ): {
    transactions: OnChainTransactionLog[];
    stats: {
      total: number;
      swaps: number;
      approvals: number;
      totalGasCost: string;
    };
  } {
    const logFile = join(process.cwd(), 'logs', 'on-chain-transactions.log');
    
    if (!existsSync(logFile)) {
      return {
        transactions: [],
        stats: {
          total: 0,
          swaps: 0,
          approvals: 0,
          totalGasCost: '0.000000',
        }
      };
    }

    try {
      const logContent = readFileSync(logFile, 'utf-8');
      const lines = logContent.split('\n').filter(line => line.trim() && !line.startsWith('#'));
      
      let transactions: OnChainTransactionLog[] = [];
      
      // Parse JSON lines
      for (const line of lines) {
        try {
          const transaction = JSON.parse(line) as OnChainTransactionLog;
          transactions.push(transaction);
        } catch (error) {
          console.warn('Failed to parse transaction line:', line);
        }
      }

      // Apply filters
      if (type) {
        transactions = transactions.filter(tx => tx.type === type);
      }
      
      if (status) {
        transactions = transactions.filter(tx => tx.status === status);
      }

      // Sort by timestamp (newest first)
      transactions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // Apply limit
      const limitNum = limit ? parseInt(limit, 10) : 50;
      transactions = transactions.slice(0, limitNum);

      // Calculate stats
      const stats = this.calculateStats(transactions);

      return {
        transactions,
        stats,
      };

    } catch (error) {
      console.error('Failed to read transaction log:', error);
      return {
        transactions: [],
        stats: {
          total: 0,
          swaps: 0,
          approvals: 0,
          totalGasCost: '0.000000',
        }
      };
    }
  }

  /**
   * 📊 Get transaction statistics only
   */
  @Get('stats')
  getStats(): {
    total: number;
    swaps: number;
    approvals: number;
    totalGasCost: string;
    recentActivity: {
      last24h: number;
      lastHour: number;
    };
  } {
    const logFile = join(process.cwd(), 'logs', 'on-chain-transactions.log');
    
    if (!existsSync(logFile)) {
      return {
        total: 0,
        swaps: 0,
        approvals: 0,
        totalGasCost: '0.000000',
        recentActivity: {
          last24h: 0,
          lastHour: 0,
        }
      };
    }

    try {
      const logContent = readFileSync(logFile, 'utf-8');
      const lines = logContent.split('\n').filter(line => line.trim() && !line.startsWith('#'));
      
      const transactions: OnChainTransactionLog[] = [];
      
      for (const line of lines) {
        try {
          const transaction = JSON.parse(line) as OnChainTransactionLog;
          transactions.push(transaction);
        } catch (error) {
          console.warn('Failed to parse transaction line:', line);
        }
      }

      const stats = this.calculateStats(transactions);
      
      // Calculate recent activity
      const now = new Date();
      const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const lastHour = new Date(now.getTime() - 60 * 60 * 1000);
      
      const recentActivity = {
        last24h: transactions.filter(tx => new Date(tx.timestamp) > last24h).length,
        lastHour: transactions.filter(tx => new Date(tx.timestamp) > lastHour).length,
      };

      return {
        ...stats,
        recentActivity,
      };

    } catch (error) {
      console.error('Failed to read transaction log:', error);
      return {
        total: 0,
        swaps: 0,
        approvals: 0,
        totalGasCost: '0.000000',
        recentActivity: {
          last24h: 0,
          lastHour: 0,
        }
      };
    }
  }

  /**
   * 📊 Calculate transaction statistics
   */
  private calculateStats(transactions: OnChainTransactionLog[]): {
    total: number;
    swaps: number;
    approvals: number;
    totalGasCost: string;
  } {
    const total = transactions.length;
    const swaps = transactions.filter(tx => tx.type === 'SWAP').length;
    const approvals = transactions.filter(tx => tx.type === 'APPROVAL').length;
    
    const totalGasCost = transactions
      .filter(tx => tx.gasCostEstimate && tx.gasCostEstimate !== 'N/A')
      .reduce((sum, tx) => {
        const cost = parseFloat(tx.gasCostEstimate.replace(' BNB', ''));
        return sum + (isNaN(cost) ? 0 : cost);
      }, 0);

    return {
      total,
      swaps,
      approvals,
      totalGasCost: totalGasCost.toFixed(6),
    };
  }
} 