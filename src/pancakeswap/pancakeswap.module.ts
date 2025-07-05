import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { LoggingModule } from '../logging/logging.module';
import { BlockchainService } from './services/blockchain.service';
import { PancakeSwapService } from './services/pancakeswap.service';

@Module({
  imports: [ConfigModule, EventEmitterModule, LoggingModule],
  providers: [BlockchainService, PancakeSwapService],
  exports: [BlockchainService, PancakeSwapService],
})
export class PancakeSwapModule {}
