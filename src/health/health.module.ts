import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { ConfigModule } from '../config/config.module';
import { ArbitrageModule } from '../arbitrage/arbitrage.module';
import { MexcModule } from '../mexc/mexc.module';
import { PancakeSwapModule } from '../pancakeswap/pancakeswap.module';

@Module({
  imports: [ConfigModule, ArbitrageModule, MexcModule, PancakeSwapModule],
  controllers: [HealthController],
})
export class HealthModule {}
