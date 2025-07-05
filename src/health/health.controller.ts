import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ConfigService } from '../config/config.service';
import { ArbitrageService } from '../arbitrage/services/arbitrage.service';
import { PriceCalculatorService } from '../arbitrage/services/price-calculator.service';
import { MexcApiService } from '../mexc/services/mexc-api.service';
import { BlockchainService } from '../pancakeswap/services/blockchain.service';

@ApiTags('monitoring')
@Controller('health')
export class HealthController {
  constructor(
    private readonly configService: ConfigService,
    @Inject(ArbitrageService)
    private readonly arbitrageService: ArbitrageService,
    @Inject(PriceCalculatorService)
    private readonly priceCalculator: PriceCalculatorService,
    @Inject(MexcApiService) private readonly mexcApiService: MexcApiService,
    @Inject(BlockchainService)
    private readonly blockchainService: BlockchainService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Health check endpoint' })
  @ApiResponse({
    status: 200,
    description: 'Service is healthy',
    schema: {
      example: {
        status: 'healthy',
        timestamp: '2024-01-01T12:00:00.000Z',
        uptime: 3600,
        environment: 'development',
        version: '1.0.0',
      },
    },
  })
  async getHealth() {
    const botStatus = this.arbitrageService.getStatus();
    const currentPrices = this.priceCalculator.getCurrentPrices();
    const currentOpportunity = this.priceCalculator.getCurrentOpportunity();

    // Check component health
    const components = await this.checkComponentHealth();

    // Determine overall status
    const hasUnhealthyComponents = Object.values(components).some(
      (status) => status === 'error' || status === 'degraded',
    );
    const overallStatus = hasUnhealthyComponents ? 'degraded' : 'healthy';

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: this.configService.nodeEnv,
      version: '1.0.0',
      arbitrage: {
        isActive: botStatus.isActive,
        isPaused: botStatus.isPaused,
        lastTradeTime: botStatus.lastTradeTime,
        cooldownRemaining: botStatus.cooldownRemaining,
        currentOpportunity: currentOpportunity
          ? {
              id: currentOpportunity.id,
              spread: currentOpportunity.spreadPercentage,
              netProfit: currentOpportunity.netProfitPercentage,
              confidence: currentOpportunity.confidence,
              direction: `${currentOpportunity.buyExchange} -> ${currentOpportunity.sellExchange}`,
            }
          : null,
      },
      prices: {
        mexc: currentPrices.mexc
          ? {
              bid: currentPrices.mexc.bidPrice,
              ask: currentPrices.mexc.askPrice,
              timestamp: currentPrices.mexc.timestamp,
            }
          : null,
        pancakeswap: currentPrices.pancakeswap
          ? {
              bid: currentPrices.pancakeswap.bidPrice,
              ask: currentPrices.pancakeswap.askPrice,
              timestamp: currentPrices.pancakeswap.timestamp,
            }
          : null,
      },
      components,
    };
  }

  private async checkComponentHealth(): Promise<Record<string, string>> {
    const components: Record<string, string> = {};

    // Check MEXC API connectivity
    try {
      await this.mexcApiService.ping();
      components.mexcApi = 'operational';
    } catch (error) {
      components.mexcApi = 'error';
    }

    // Check BSC connectivity
    try {
      const gasPrice = await this.blockchainService.getGasPrice();
      components.bscRpc =
        gasPrice && gasPrice !== 'NaN' ? 'operational' : 'degraded';
    } catch (error) {
      components.bscRpc = 'error';
    }

    // Check price data freshness
    const prices = this.priceCalculator.getCurrentPrices();
    const now = Date.now();
    const mexcAge = prices.mexc
      ? now - prices.mexc.timestamp.getTime()
      : Infinity;
    const pancakeAge = prices.pancakeswap
      ? now - prices.pancakeswap.timestamp.getTime()
      : Infinity;

    if (mexcAge < 30000 && pancakeAge < 30000) {
      // Less than 30 seconds old
      components.priceData = 'operational';
    } else if (mexcAge < 60000 && pancakeAge < 60000) {
      // Less than 1 minute old
      components.priceData = 'degraded';
    } else {
      components.priceData = 'error';
    }

    // Config validation
    try {
      this.configService.validateConfig();
      components.config = 'operational';
    } catch (error) {
      components.config = 'error';
    }

    return components;
  }
}
