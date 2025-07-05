import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggingModule } from '../logging/logging.module';
import { MexcModule } from '../mexc/mexc.module';
import { PancakeSwapModule } from '../pancakeswap/pancakeswap.module';
import { ArbitrageService } from './services/arbitrage.service';
import { PriceCalculatorService } from './services/price-calculator.service';
import { ArbitrageExecutorService } from './services/arbitrage-executor.service';
import { MonitoringService } from './services/monitoring.service';
import { ILMTOptimizedStrategyService } from './services/ilmt-optimized-strategy.service';

@Module({
  imports: [
    ConfigModule,
    EventEmitterModule,
    ScheduleModule,
    LoggingModule,
    MexcModule,
    PancakeSwapModule,
  ],
  providers: [
    PriceCalculatorService,
    ArbitrageExecutorService,
    ArbitrageService,
    MonitoringService,
    ILMTOptimizedStrategyService,
  ],
  exports: [
    ArbitrageService,
    PriceCalculatorService,
    ArbitrageExecutorService,
    MonitoringService,
    ILMTOptimizedStrategyService,
  ],
})
export class ArbitrageModule {}
