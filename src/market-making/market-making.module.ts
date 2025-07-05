import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ConfigModule } from '../config/config.module';
import { LoggingModule } from '../logging/logging.module';
import { MexcModule } from '../mexc/mexc.module';
import { PancakeSwapModule } from '../pancakeswap/pancakeswap.module';
import { MarketMakingService } from './services/market-making.service';
import { MarketMakingController } from './controllers/market-making.controller';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ConfigModule,
    LoggingModule,
    MexcModule,
    PancakeSwapModule,
  ],
  providers: [MarketMakingService],
  controllers: [MarketMakingController],
  exports: [MarketMakingService],
})
export class MarketMakingModule {} 