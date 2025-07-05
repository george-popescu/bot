// Fix crypto polyfill for Node.js scheduler
import { webcrypto } from 'crypto';
if (!globalThis.crypto) {
  globalThis.crypto = webcrypto as any;
}

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { LoggingService } from './logging/logging.service';
import { ConfigService } from './config/config.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  // Get services
  const loggingService = app.get(LoggingService);
  const configService = app.get(ConfigService);

  // Use custom logger
  app.useLogger(loggingService);

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Enable CORS for development
  if (configService.isDevelopment) {
    app.enableCors({
      origin: ['http://localhost:3001', 'http://localhost:5173'], // Frontend ports
      credentials: true,
    });
  }

  // Swagger documentation
  if (!configService.isProduction) {
    const config = new DocumentBuilder()
      .setTitle('Arbitrage Bot API')
      .setDescription('ILMT/USDT Arbitrage Bot API Documentation')
      .setVersion('1.0')
      .addTag('arbitrage')
      .addTag('config')
      .addTag('monitoring')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  // Global prefix for API routes
  app.setGlobalPrefix('api', {
    exclude: ['health'], // Health check without prefix
  });

  const port = configService.port;

  await app.listen(port);

  // Log configuration and startup
  loggingService.logConfigurationLoad();
  loggingService.info(`Application started on port ${port}`, {
    component: 'Bootstrap',
    operation: 'APP_START',
    port,
    environment: configService.nodeEnv,
    docsUrl: configService.isProduction
      ? null
      : `http://localhost:${port}/api/docs`,
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    loggingService.info('SIGTERM received, shutting down gracefully', {
      component: 'Bootstrap',
      operation: 'SHUTDOWN',
    });
    await app.close();
  });

  process.on('SIGINT', async () => {
    loggingService.info('SIGINT received, shutting down gracefully', {
      component: 'Bootstrap',
      operation: 'SHUTDOWN',
    });
    await app.close();
  });
}

bootstrap().catch((error) => {
  console.error('Application failed to start:', error);
  process.exit(1);
});
