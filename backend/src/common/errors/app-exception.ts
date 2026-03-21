import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes';

export class AppException extends HttpException {
  constructor(
    code: ErrorCode,
    message: string,
    status = HttpStatus.BAD_REQUEST,
    data?: Record<string, unknown>
  ) {
    super(
      {
        requestId: 'local-dev',
        code,
        message,
        data: data ?? {}
      },
      status
    );
  }
}
