import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';

function isPayloadTooLargeException(
  exception: unknown,
): exception is Error & { status?: number; type?: string } {
  return (
    exception instanceof Error &&
    (
      (typeof (exception as { status?: unknown }).status === 'number' &&
        (exception as { status?: number }).status === HttpStatus.PAYLOAD_TOO_LARGE) ||
      (typeof (exception as { type?: unknown }).type === 'string' &&
        (exception as { type?: string }).type === 'entity.too.large')
    )
  );
}

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      response.status(status).json(payload);
      return;
    }

    if (isPayloadTooLargeException(exception)) {
      response.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
        requestId: 'local-dev',
        code: 'PAYLOAD_TOO_LARGE',
        message: 'request entity too large',
        data: {
          hint: '请减少单次提交内容，或联系平台调整请求体上限。'
        }
      });
      return;
    }

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      requestId: 'local-dev',
      code: 'INTERNAL_ERROR',
      message: exception instanceof Error ? exception.message : 'Internal server error',
      data: {}
    });
  }
}
