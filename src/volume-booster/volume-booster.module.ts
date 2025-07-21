import { Module } from '@nestjs/common';
import { VolumeBoosterService } from './services/volume-booster.service';
import { VolumeBoosterController } from './controllers/volume-booster.controller';
import { MexcModule } from '../mexc/mexc.module';
import { ConfigModule } from '../config/config.module';
import { LoggingModule } from '../logging/logging.module';

@Module({
  imports: [MexcModule, ConfigModule, LoggingModule],
  controllers: [VolumeBoosterController],
  providers: [VolumeBoosterService],
  exports: [VolumeBoosterService],
})
export class VolumeBoosterModule {} 