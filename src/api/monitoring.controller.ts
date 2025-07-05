import { Controller, Get, Post, Body } from '@nestjs/common';
import {
  MonitoringService,
  MonitoringStats,
  VirtualBalance,
} from '../arbitrage/services/monitoring.service';
import { ArbitrageOpportunity } from '../arbitrage/types/arbitrage.types';

@Controller('monitoring')
export class MonitoringController {
  constructor(private readonly monitoringService: MonitoringService) {}

  @Get('stats')
  getStats(): MonitoringStats & { virtualBalance: VirtualBalance } {
    return this.monitoringService.getMonitoringStats();
  }

  @Post('simulate')
  async simulateOpportunity(
    @Body() opportunity: ArbitrageOpportunity,
  ): Promise<{ success: boolean }> {
    await this.monitoringService.simulateArbitrage(opportunity);
    return { success: true };
  }

  @Post('log-opportunity')
  logOpportunity(@Body() opportunity: ArbitrageOpportunity): {
    success: boolean;
  } {
    this.monitoringService.logOpportunity(opportunity);
    return { success: true };
  }

  @Post('reset')
  resetStats(): { success: boolean } {
    this.monitoringService.resetStats();
    return { success: true };
  }
}
