import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { LoggingService } from '../../logging/logging.service';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly loggingService: LoggingService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const now = Date.now();
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const { method, url, ip } = req;
    const userAgent = req.get('User-Agent') || '';

    return next.handle().pipe(
      tap((data) => {
        const { statusCode } = res;
        const duration = Date.now() - now;

        // Only log non-health check endpoints to reduce noise
        if (!url.includes('/health') && !url.includes('/favicon.ico')) {
          this.loggingService.info(
            `${method} ${url} ${statusCode} - ${duration}ms`,
            {
              component: 'HTTPInterceptor',
              operation: 'HTTP_REQUEST',
              duration,
              method,
              url,
              statusCode,
              ip,
              userAgent,
              responseSize: data ? JSON.stringify(data).length : 0,
            },
          );
        }
      }),
    );
  }
}
