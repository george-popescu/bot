import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TransactionsController } from './api/transactions.controller';

// Configuration
import { ConfigModule as CustomConfigModule } from './config/config.module';
import { ConfigService } from './config/config.service';

// Logging
import { LoggingModule } from './logging/logging.module';
// import { LoggingService } from './logging/logging.service';

// Health
import { HealthModule } from './health/health.module';

// Feature modules
import { MexcModule } from './mexc/mexc.module';
import { PancakeSwapModule } from './pancakeswap/pancakeswap.module';
import { ArbitrageModule } from './arbitrage/arbitrage.module';
import { MarketMakingModule } from './market-making/market-making.module';
import { MonitoringController } from './api/monitoring.controller';
import { ILMTStrategyController } from './api/ilmt-strategy.controller';
import { validationSchema } from './config/validation.schema';

// Common
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    CustomConfigModule,
    LoggingModule,
    HealthModule,

    // Feature modules
    MexcModule,
    PancakeSwapModule,
    ArbitrageModule,
    MarketMakingModule,

    // Future feature modules
    // BalanceModule,
    // ApiModule,
  ],
  controllers: [
    AppController,
    MonitoringController,
    ILMTStrategyController,
    TransactionsController,
  ],
  providers: [
    AppService,
    ConfigService,
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule {}
