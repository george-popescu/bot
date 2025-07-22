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
    
    // Allow higher volumes for HIGH_VOLUME_BURST strategy
    const maxTradeLimit = config.strategy === 'HIGH_VOLUME_BURST' ? 50000 : 1000;
    if (config.maxTradeSize && config.maxTradeSize > maxTradeLimit) {
      throw new Error(`Maximum trade size must be at most ${maxTradeLimit} ILMT for safety`);
    }
    
    // Validate burst configuration if present
    if (config.burstMinVolume && config.burstMinVolume < 100) {
      throw new Error('Minimum burst volume must be at least 100 USDT');
    }
    
    if (config.burstMaxVolume && config.burstMaxVolume > 50000) {
      throw new Error('Maximum burst volume must be at most 50,000 USDT for safety');
    }
    
    if (config.burstMinExecutions && config.burstMinExecutions < 1) {
      throw new Error('Minimum burst executions must be at least 1');
    }
    
    if (config.burstMaxExecutions && config.burstMaxExecutions > 20) {
      throw new Error('Maximum burst executions must be at most 20 for safety');
    }
    
    // Force monitoring mode for safety if trying to enable real trading
    if (config.monitoringMode === false) {
      throw new Error('Real trading mode disabled for safety. Contact developer to enable.');
    }

    return { message: 'Configuration updated', timestamp: new Date() };
  }
} 