import {
  Catch,
  ArgumentsHost,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(
    exception: any,
    host: ArgumentsHost
  ) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errorCode: string | undefined;
    let field: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse() as any;

      message =
        (typeof res === 'string' && res) ||
        (typeof res?.message === 'string' && res.message) ||
        (Array.isArray(res?.message) && res.message.join('; ')) ||
        exception.message ||
        'HTTP error';

      if (typeof res === 'object' && res !== null) {
        errorCode = res.error_code;
        field = res.field;
      }
    } else if (exception?.message) {
      message = exception.message;
    } else if (typeof exception === 'string') {
      message = exception;
    } else {
      message = String(exception);
    }

    const responseBody: any = {
      statusCode: status,
      message: message,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    if (errorCode !== undefined) {
      responseBody.error_code = errorCode;
    }
    if (field !== undefined) {
      responseBody.field = field;
    }

    response.status(status).json(responseBody);
  }
}
