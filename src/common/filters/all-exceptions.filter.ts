import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { LoggingService } from '../../logging/logging.service';
import {
  ArbitrageError,
  MexcApiError,
  BlockchainError,
  ConfigurationError,
} from '../types';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly loggingService: LoggingService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, message, code } = this.processException(exception);

    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message,
      code,
      ...(process.env.NODE_ENV === 'development' && {
        stack: exception instanceof Error ? exception.stack : undefined,
      }),
    };

    // Log the error
    this.loggingService.logSystemError(
      exception instanceof Error ? exception : new Error(String(exception)),
      {
        component: 'ExceptionFilter',
        operation: 'EXCEPTION_CAUGHT',
        path: request.url,
        method: request.method,
        statusCode: status,
      },
    );

    response.status(status).json(errorResponse);
  }

  private processException(exception: unknown): {
    status: number;
    message: string;
    code: string;
  } {
    // Handle known HTTP exceptions
    if (exception instanceof HttpException) {
      return {
        status: exception.getStatus(),
        message: exception.message,
        code: 'HTTP_EXCEPTION',
      };
    }

    // Handle custom arbitrage errors
    if (exception instanceof ArbitrageError) {
      return this.processArbitrageError(exception);
    }

    // Handle unknown errors
    if (exception instanceof Error) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message:
          process.env.NODE_ENV === 'production'
            ? 'Internal server error'
            : exception.message,
        code: 'INTERNAL_ERROR',
      };
    }

    // Handle non-Error exceptions
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Unknown error occurred',
      code: 'UNKNOWN_ERROR',
    };
  }

  private processArbitrageError(error: ArbitrageError): {
    status: number;
    message: string;
    code: string;
  } {
    switch (true) {
      case error instanceof MexcApiError:
        return {
          status: this.getMexcHttpStatus(error),
          message: error.message,
          code: error.code,
        };

      case error instanceof BlockchainError:
        return {
          status: HttpStatus.BAD_GATEWAY,
          message: error.message,
          code: error.code,
        };

      case error instanceof ConfigurationError:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: error.message,
          code: error.code,
        };

      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: error.message,
          code: error.code,
        };
    }
  }

  private getMexcHttpStatus(error: MexcApiError): number {
    if (error.statusCode) {
      // Map MEXC API status codes to HTTP status codes
      switch (error.statusCode) {
        case 400:
          return HttpStatus.BAD_REQUEST;
        case 401:
          return HttpStatus.UNAUTHORIZED;
        case 403:
          return HttpStatus.FORBIDDEN;
        case 429:
          return HttpStatus.TOO_MANY_REQUESTS;
        case 500:
          return HttpStatus.BAD_GATEWAY;
        default:
          return HttpStatus.BAD_GATEWAY;
      }
    }
    return HttpStatus.BAD_GATEWAY;
  }
}
