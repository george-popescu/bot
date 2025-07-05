import { Injectable, LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as winston from 'winston';
import {
  LogLevel,
  LogContext,
  Trade,
  ArbitrageOpportunity,
} from '../common/types';

@Injectable()
export class LoggingService implements LoggerService {
  private readonly logger: winston.Logger;

  constructor(private readonly configService: ConfigService) {
    this.logger = winston.createLogger({
      level: this.configService.get<string>('LOG_LEVEL', 'info'),
      format: this.getLogFormat(),
      transports: this.getTransports(),
      exitOnError: false,
    });
  }

  private getLogFormat(): winston.Logform.Format {
    const isDevelopment =
      this.configService.get<string>('NODE_ENV') === 'development';

    if (isDevelopment) {
      return winston.format.combine(
        winston.format.timestamp(),
        winston.format.colorize(),
        winston.format.printf(
          ({ timestamp, level, message, context, ...meta }) => {
            const ctx = context as LogContext;
            const contextStr = ctx?.component ? `[${ctx.component}]` : '[App]';
            const metaStr = Object.keys(meta).length
              ? ` ${JSON.stringify(meta)}`
              : '';
            return `${timestamp} ${level} ${contextStr} ${message}${metaStr}`;
          },
        ),
      );
    }

    return winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json(),
    );
  }

  private getTransports(): winston.transport[] {
    const transports: winston.transport[] = [new winston.transports.Console()];

    const isDevelopment =
      this.configService.get<string>('NODE_ENV') === 'development';

    if (!isDevelopment) {
      // Production file transports
      transports.push(
        new winston.transports.File({
          filename: 'logs/error.log',
          level: 'error',
          maxsize: 10 * 1024 * 1024, // 10MB
          maxFiles: 5,
        }),
        new winston.transports.File({
          filename: 'logs/trades.log',
          level: 'info',
          maxsize: 50 * 1024 * 1024, // 50MB
          maxFiles: 10,
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json(),
          ),
        }),
        new winston.transports.File({
          filename: 'logs/app.log',
          level: 'info',
          maxsize: 20 * 1024 * 1024, // 20MB
          maxFiles: 7,
        }),
      );
    }

    return transports;
  }

  // NestJS LoggerService interface
  log(message: any, context?: string): void {
    this.info(message, context ? { component: context } : {});
  }

  error(message: any, trace?: string, context?: string): void {
    this.logger.error(message, {
      context: context ? { component: context } : {},
      stack: trace,
    });
  }

  warn(message: any, context?: string): void {
    this.logger.warn(message, {
      context: context ? { component: context } : {},
    });
  }

  debug(message: any, context?: string): void {
    this.logger.debug(message, {
      context: context ? { component: context } : {},
    });
  }

  verbose(message: any, context?: string): void {
    this.logger.verbose(message, {
      context: context ? { component: context } : {},
    });
  }

  // Custom logging methods
  info(message: string, context?: LogContext): void {
    this.logger.info(message, { context });
  }

  logTrade(trade: Trade): void {
    this.logger.info('Trade executed', {
      context: {
        component: 'ArbitrageService',
        operation: 'TRADE_EXECUTED',
        tradeId: trade.id,
      },
      trade: {
        id: trade.id,
        pair: trade.pair,
        direction: trade.direction,
        profit: trade.profit,
        profitUsd: trade.profitUsd,
        executionTimeMs: trade.executionTimeMs,
        status: trade.status,
        mexcOrderId: trade.mexcOrderId,
        bscTxHash: trade.bscTxHash,
      },
    });
  }

  logOpportunity(opportunity: ArbitrageOpportunity, executed: boolean): void {
    this.logger.info(
      `Arbitrage opportunity ${executed ? 'executed' : 'detected'}`,
      {
        context: {
          component: 'ArbitrageService',
          operation: executed ? 'OPPORTUNITY_EXECUTED' : 'OPPORTUNITY_DETECTED',
        },
        opportunity: {
          id: opportunity.id,
          pair: opportunity.pair,
          spreadPercent: opportunity.spreadPercent,
          estimatedProfitUsd: opportunity.estimatedProfitUsd,
          direction: opportunity.direction,
          executable: opportunity.executable,
          reason: opportunity.reason,
        },
      },
    );
  }

  logPriceUpdate(
    mexcPrice: number,
    dexPrice: number,
    spread: number,
    pair: string,
  ): void {
    this.logger.debug('Price update', {
      context: {
        component: 'PriceMonitor',
        operation: 'PRICE_UPDATE',
        pair,
      },
      prices: {
        mexc: mexcPrice,
        dex: dexPrice,
        spread,
        spreadPercent: ((spread / mexcPrice) * 100).toFixed(4),
      },
    });
  }

  logApiCall(
    service: string,
    method: string,
    duration: number,
    success: boolean,
    error?: string,
  ): void {
    const level = success ? 'debug' : 'warn';
    this.logger[level](`API call ${success ? 'completed' : 'failed'}`, {
      context: {
        component: service,
        operation: 'API_CALL',
        duration,
      },
      api: {
        method,
        success,
        error,
      },
    });
  }

  logBalanceUpdate(
    platform: string,
    balances: { [asset: string]: number },
  ): void {
    this.logger.info('Balance update', {
      context: {
        component: 'BalanceService',
        operation: 'BALANCE_UPDATE',
      },
      platform,
      balances,
    });
  }

  logSystemError(error: Error, context: LogContext): void {
    this.logger.error('System error occurred', {
      context: {
        ...context,
        operation: 'SYSTEM_ERROR',
      },
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    });
  }

  logConfigurationLoad(): void {
    this.logger.info('Configuration loaded successfully', {
      context: {
        component: 'ConfigService',
        operation: 'CONFIG_LOADED',
      },
      config: {
        nodeEnv: this.configService.get('NODE_ENV'),
        botEnabled: this.configService.get('BOT_ENABLED'),
        logLevel: this.configService.get('LOG_LEVEL'),
      },
    });
  }

  logWebSocketEvent(event: string, success: boolean, details?: any): void {
    const level = success ? 'debug' : 'warn';
    this.logger[level](`WebSocket ${event}`, {
      context: {
        component: 'WebSocketService',
        operation: 'WS_EVENT',
      },
      event,
      success,
      details,
    });
  }

  logPerformanceMetric(
    operation: string,
    duration: number,
    context?: LogContext,
  ): void {
    this.logger.info('Performance metric', {
      context: {
        ...context,
        operation: 'PERFORMANCE_METRIC',
      },
      metric: {
        operation,
        duration,
        timestamp: new Date(),
      },
    });
  }

  // Helper methods
  setLogLevel(level: LogLevel): void {
    this.logger.level = level;
  }

  getLogLevel(): string {
    return this.logger.level;
  }

  // Create child logger with default context
  createChildLogger(defaultContext: LogContext): winston.Logger {
    return this.logger.child({ context: defaultContext });
  }
}
