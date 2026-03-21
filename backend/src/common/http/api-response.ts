import { ErrorCode } from '../errors/error-codes';

export interface ApiResponse<T> {
  requestId: string;
  code: ErrorCode;
  message: string;
  data: T;
  meta?: Record<string, unknown>;
}

export function ok<T>(data: T, requestId = 'local-dev'): ApiResponse<T> {
  return {
    requestId,
    code: 'OK',
    message: 'success',
    data
  };
}

export function business<T>(code: ErrorCode, message: string, data: T, requestId = 'local-dev'): ApiResponse<T> {
  return {
    requestId,
    code,
    message,
    data
  };
}
