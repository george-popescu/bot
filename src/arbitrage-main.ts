import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ArbitrageModule } from './arbitrage/arbitrage.module';
import { ConfigService } from './config/config.service';
import { LoggingService } from './logging/logging.service';

async function bootstrap() {
  const app = await NestFactory.create(ArbitrageModule);
  
  const configService = app.get(ConfigService);
  const loggingService = app.get(LoggingService);
  
  // Enable CORS
  app.enableCors();
  
  const port = 3001; // Port dedicat pentru arbitraj
  
  await app.listen(port);
  
  loggingService.info(`🚀 Arbitrage Bot started on port ${port}`, {
    component: 'ArbitrageMain',
    port,
    environment: process.env.NODE_ENV,
  });
  
  Logger.log(`🔄 Arbitrage Bot is running on: http://localhost:${port}`, 'Bootstrap');
}

bootstrap().catch((error) => {
  Logger.error('❌ Failed to start Arbitrage Bot', error, 'Bootstrap');
  process.exit(1);
}); 