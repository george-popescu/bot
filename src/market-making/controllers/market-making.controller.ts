import { Controller, Get, Post, Body, Patch } from '@nestjs/common';
import { MarketMakingService, MarketMakingConfig } from '../services/market-making.service';

@Controller('api/market-making')
export class MarketMakingController {
  constructor(private readonly marketMakingService: MarketMakingService) {}

  @Get('status')
  getStatus() {
    return this.marketMakingService.getStatus();
  }

  @Post('start')
  async start() {
    await this.marketMakingService.start();
    return { message: 'Market making started' };
  }

  @Post('stop')
  async stop() {
    await this.marketMakingService.stop();
    return { message: 'Market making stopped' };
  }

  @Patch('config')
  updateConfig(@Body() config: Partial<MarketMakingConfig>) {
    this.marketMakingService.updateConfig(config);
    return { message: 'Configuration updated', config };
  }
} 