import crypto from 'node:crypto';
import fs from 'node:fs';
import { NextFunction, Request, Response } from 'express';
import { logger } from './logger';

export function loadMetricsToken(filePath: string): string {
  let contents: string;

  try {
    contents = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Unable to read metrics token file at ${filePath}: ${message}`);
  }

  const token = contents.trim();
  if (!token) {
    throw new Error(`Metrics token file at ${filePath} is empty`);
  }
  if (/\s/.test(token)) {
    throw new Error(
      `Metrics token file at ${filePath} must contain a single token without whitespace`
    );
  }
  return token;
}

function digest(value: string): Buffer {
  return crypto.createHash('sha256').update(value).digest();
}

export function createMetricsAuthMiddleware(expectedToken: string) {
  const token = expectedToken.trim();
  if (!token) {
    throw new Error('Metrics token must not be empty');
  }
  const expectedDigest = digest(token);

  return function metricsAuth(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    const header = req.header('authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    const provided = match ? match[1].trim() : '';

    if (!provided || !crypto.timingSafeEqual(digest(provided), expectedDigest)) {
      logger.debug('Rejected metrics scrape', {
        method: req.method,
        path: req.path,
      });
      res.set('WWW-Authenticate', 'Bearer');
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or missing metrics token',
        },
      });
      return;
    }

    next();
  };
}
