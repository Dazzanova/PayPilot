import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
  details?: unknown;
}

export function errorHandler(
  err: AppError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void {
  const payloadTooLarge =
    typeof err === 'object' &&
    err !== null &&
    (err as { type?: string }).type === 'entity.too.large';

  const statusCode = payloadTooLarge ? 413 : err.statusCode || 500;
  const message = payloadTooLarge
    ? 'The uploaded file is too large.'
    : err.message || 'Internal Server Error';
  const code = payloadTooLarge ? 'PAYLOAD_TOO_LARGE' : err.code || 'INTERNAL_ERROR';

  logger.error(`Error on ${req.method} ${req.originalUrl}:`, {
    message,
    code,
    statusCode,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });

  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      ...(err.details ? { details: err.details } : {}),
    },
    meta: {
      timestamp: new Date().toISOString(),
      path: req.originalUrl,
    },
  });
}
