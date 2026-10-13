import { Router, Request, Response } from 'express';
import { checkDatabaseConnection } from '../lib/prisma';

export const healthRouter = Router();

// GET /api/health - Lightweight API runtime health status
healthRouter.get('/', (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    data: {
      status: 'healthy',
      service: 'paypilot-api',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      memoryUsageMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    },
  });
});

// GET /api/health/db - Separate database connectivity check
healthRouter.get('/db', async (req: Request, res: Response) => {
  const dbStatus = await checkDatabaseConnection();

  if (dbStatus.connected) {
    res.status(200).json({
      success: true,
      data: {
        database: 'connected',
        latencyMs: dbStatus.latencyMs,
        timestamp: new Date().toISOString(),
      },
    });
  } else {
    res.status(503).json({
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Could not establish connection to PostgreSQL / Supabase',
        details: dbStatus.error,
      },
      data: {
        database: 'disconnected',
        latencyMs: dbStatus.latencyMs,
        timestamp: new Date().toISOString(),
      },
    });
  }
});
