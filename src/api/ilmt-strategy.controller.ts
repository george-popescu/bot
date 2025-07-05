import { Controller, Get, Post, Body } from '@nestjs/common';
import { ILMTOptimizedStrategyService } from '../arbitrage/services/ilmt-optimized-strategy.service';
import { PriceCalculatorService } from '../arbitrage/services/price-calculator.service';
import { PancakeSwapService } from '../pancakeswap/services/pancakeswap.service';
import { LoggingService } from '../logging/logging.service';

@Controller('ilmt-strategy')
export class ILMTStrategyController {
  constructor(
    private readonly ilmtOptimizedStrategyService: ILMTOptimizedStrategyService,
    private readonly priceCalculatorService: PriceCalculatorService,
    private readonly pancakeSwapService: PancakeSwapService,
    private readonly loggingService: LoggingService,
  ) {}

  @Get('test-router')
  async testRouter() {
    try {
      const result = await this.pancakeSwapService.testRouterWithRealTokens();
      return {
        success: true,
        data: result,
        message: 'Router test completed successfully with WBNB/USDT pair',
      };
    } catch (error) {
      this.loggingService.error('Router test failed', error instanceof Error ? error.message : String(error));
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: 'Router test failed - check logs for details',
      };
    }
  }

  @Get('portfolio')
  async getPortfolio() {
    try {
      const portfolio = this.ilmtOptimizedStrategyService.getCurrentPortfolio();
      return {
        success: true,
        data: portfolio,
      };
    } catch (error) {
      this.loggingService.error('Failed to get ILMT portfolio', error instanceof Error ? error.message : String(error));
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  @Get('analyze')
  async analyzeStrategy() {
    try {
      // Obține prețurile curente
      const prices = await this.priceCalculatorService.getCurrentPrices();
      
      if (!prices.mexc || !prices.pancakeswap) {
        return {
          success: false,
          error: 'Could not fetch prices from both exchanges',
        };
      }

      // Analizează strategia optimă
      const strategy = await this.ilmtOptimizedStrategyService.analyzeOptimalStrategy(
        prices.mexc,
        prices.pancakeswap,
      );

      return {
        success: true,
        data: {
          prices: {
            mexc: prices.mexc,
            pancakeswap: prices.pancakeswap,
          },
          strategy: strategy,
          portfolio: this.ilmtOptimizedStrategyService.getCurrentPortfolio(),
        },
      };
    } catch (error) {
      this.loggingService.error('Failed to analyze ILMT strategy', error instanceof Error ? error.message : String(error));
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  @Post('execute')
  async executeStrategy(@Body() body: { strategyType?: string }) {
    try {
      // Obține prețurile curente
      const prices = await this.priceCalculatorService.getCurrentPrices();
      
      if (!prices.mexc || !prices.pancakeswap) {
        return {
          success: false,
          error: 'Could not fetch prices from both exchanges',
        };
      }

      // Analizează strategia optimă
      const strategy = await this.ilmtOptimizedStrategyService.analyzeOptimalStrategy(
        prices.mexc,
        prices.pancakeswap,
      );

      // Execută strategia
      const executed = await this.ilmtOptimizedStrategyService.executeStrategy(strategy);

      return {
        success: true,
        data: {
          strategy: strategy,
          executed: executed,
          portfolio: this.ilmtOptimizedStrategyService.getCurrentPortfolio(),
        },
      };
    } catch (error) {
      this.loggingService.error('Failed to execute ILMT strategy', error instanceof Error ? error.message : String(error));
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  @Get('price-history')
  getPriceHistory() {
    try {
      const history = this.ilmtOptimizedStrategyService.getPriceHistory();
      return {
        success: true,
        data: history,
      };
    } catch (error) {
      this.loggingService.error('Failed to get price history', error instanceof Error ? error.message : String(error));
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  @Get('current-prices')
  getCurrentPrices() {
    try {
      const prices = this.priceCalculatorService.getCurrentPrices();
      
      return {
        success: true,
        data: {
          mexc: prices.mexc,
          pancakeswap: prices.pancakeswap,
          timestamp: new Date(),
        },
      };
    } catch (error) {
      this.loggingService.error('Failed to get current prices', error instanceof Error ? error.message : String(error));
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
} 