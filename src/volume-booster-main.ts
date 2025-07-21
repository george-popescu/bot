/* eslint-disable @typescript-eslint/no-misused-promises */
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { LoggingModule } from './logging/logging.module';
import { VolumeBoosterModule } from './volume-booster/volume-booster.module';
import { VolumeBoosterService } from './volume-booster/services/volume-booster.service';

@Module({
  imports: [ConfigModule, LoggingModule, VolumeBoosterModule],
})
class VolumeBoosterApp {}

async function bootstrap() {
  console.log('🔧 Creating NestJS application...');
  const app = await NestFactory.create(VolumeBoosterApp, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });
  console.log('✅ NestJS application created successfully');

  // Get Volume Booster service and start it
  console.log('🔍 Getting Volume Booster service...');
  const volumeBoosterService = app.get(VolumeBoosterService);
  console.log('✅ Volume Booster service retrieved');

  // Get current status before starting
  const initialStatus = volumeBoosterService.getStatus();
  console.log(
    '📊 Initial Volume Booster status:',
    JSON.stringify(initialStatus, null, 2),
  );

  console.log('🚀 Starting ILMT Volume Booster...');
  console.log('⚠️  MONITORING MODE: Real trading is disabled for safety');
  console.log('📊 Conservative Settings: 150-300 ILMT per trade');
  console.log('🔄 Random intervals: 1-5 minutes between cycles');
  console.log('');

  console.log('🎬 Attempting to start Volume Booster service...');
  await volumeBoosterService.start();
  console.log('✅ Volume Booster service start command completed');

  // Keep the application running
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, stopping Volume Booster...');
    await volumeBoosterService.stop();
    await app.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, stopping Volume Booster...');
    await volumeBoosterService.stop();
    await app.close();
    process.exit(0);
  });

  console.log('✅ Volume Booster is running in standalone mode');
  console.log('📝 Check logs for trading activity');
  console.log('🛑 Press Ctrl+C to stop');
}

bootstrap().catch((error) => {
  console.error('❌ Failed to start Volume Booster:', error);
  process.exit(1);
});
