/* eslint-disable @typescript-eslint/no-misused-promises */
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { MarketMakingModule } from './market-making/market-making.module';
import { MarketMakingService } from './market-making/services/market-making.service';
import { LoggingService } from './logging/logging.service';

async function bootstrap() {
  const app = await NestFactory.create(MarketMakingModule);

  const configService = app.get(ConfigService);
  const loggingService = app.get(LoggingService);
  const marketMakingService = app.get(MarketMakingService);

  const port = configService.get<number>('PORT', 3001);

  // Enable CORS
  app.enableCors();

  // Start HTTP server
  await app.listen(port);

  loggingService.info(`🏪 Market Making Bot started on port ${port}`);

  // Auto-start market making if enabled
  const mmEnabled = configService.get<boolean>('MM_ENABLED', false);
  console.log('mmEnabled', mmEnabled);
  if (mmEnabled) {
    loggingService.info('Auto-starting market making...');
    await marketMakingService.start();
  }

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    loggingService.info(
      'SIGINT received, shutting down market making bot gracefully',
    );
    await marketMakingService.stop();
    await app.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    loggingService.info(
      'SIGTERM received, shutting down market making bot gracefully',
    );
    await marketMakingService.stop();
    await app.close();
    process.exit(0);
  });
}

bootstrap().catch((error) => {
  console.error('Failed to start market making bot:', error);
  process.exit(1);
});
