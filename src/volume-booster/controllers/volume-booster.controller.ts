import { Controller, Post, Get, Body, Patch } from '@nestjs/common';
import { VolumeBoosterService, VolumeBoosterConfig } from '../services/volume-booster.service';

@Controller('api/volume-booster')
export class VolumeBoosterController {
  constructor(private readonly volumeBoosterService: VolumeBoosterService) {}

  /**
   * Get Volume Booster status
   */
  @Get('status')
  getStatus() {
    return this.volumeBoosterService.getStatus();
  }

  /**
   * Start Volume Booster
   */
  @Post('start')
  async start() {
    await this.volumeBoosterService.start();
    return { message: 'Volume Booster started', timestamp: new Date() };
  }

  /**
   * Stop Volume Booster
   */
  @Post('stop')
  async stop() {
    await this.volumeBoosterService.stop();
    return { message: 'Volume Booster stopped', timestamp: new Date() };
  }

  /**
   * Update Volume Booster configuration
   */
  @Patch('config')
  async updateConfig(@Body() config: Partial<VolumeBoosterConfig>) {
    // Basic validation to ensure safe operation
    if (config.minTradeSize && config.minTradeSize < 150) {
      throw new Error('Minimum trade size must be at least 150 ILMT');
    }
    
    if (config.maxTradeSize && config.maxTradeSize > 1000) {
      throw new Error('Maximum trade size must be at most 1000 ILMT for safety');
    }
    
    // Force monitoring mode for safety if trying to enable real trading
    if (config.monitoringMode === false) {
      throw new Error('Real trading mode disabled for safety. Contact developer to enable.');
    }

    return { message: 'Configuration updated', timestamp: new Date() };
  }
} 