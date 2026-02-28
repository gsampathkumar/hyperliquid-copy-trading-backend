import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { LoggerService } from '@hyperliquid-api/main/shared/modules/util/logger.service';

@Injectable()
export class InstrumentInterceptor implements NestInterceptor {
  constructor(private logger: LoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const method = request.method;
    const url = request.url;

    const shouldInstrument = url !== '/v1' && url !== '/health' && !url.startsWith('/health/');

    if (shouldInstrument) {
      const now = Date.now();

      this.logger.instrument(`${method} ${url} - START`);

      return next.handle().pipe(
        finalize(() => {
          const ms = Date.now() - now;
          this.logger.instrument(`${method} ${url} - END - ${ms}ms`);
        })
      );
    }

    return next.handle();
  }
}
