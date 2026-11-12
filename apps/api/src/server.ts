import express from 'express';
import cors from 'cors';
import { config, resolveRepoPath } from './config/env';
import { logger } from './lib/logger';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';
import { apiRouter } from './routes';
import { prisma } from './lib/prisma';
import {
  createHttpMetricsMiddleware,
  initializeBusinessMetricSeries,
  metricsHandler,
} from './lib/metrics';
import {
  createMetricsAuthMiddleware,
  loadMetricsToken,
} from './lib/metricsAuth';
import { startDbProbe } from './lib/dbProbe';

const app = express();

function loadMetricsTokenOrExit(): string {
  try {
    return loadMetricsToken(resolveRepoPath(config.METRICS_TOKEN_FILE));
  } catch (error) {
    logger.error(
      'Unable to load the metrics bearer token. Create .secrets/paypilot_metrics_token (see docs/OBSERVABILITY.md).',
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  }
}

const metricsToken = loadMetricsTokenOrExit();
initializeBusinessMetricSeries();

// /metrics stays outside CORS, body parsing, request logging, and HTTP metrics.
app.get('/metrics', createMetricsAuthMiddleware(metricsToken), metricsHandler);

// Security and utility middlewares
app.use(
  cors({
    origin: config.CORS_ORIGIN,
    credentials: true,
  })
);
// HTTP metrics run before body parsing so upload and JSON parse time is counted.
app.use(createHttpMetricsMiddleware());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

// Mount API routes under /api
app.use('/api', apiRouter);

// Catch-all 404 handler for undefined API routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Cannot ${req.method} ${req.originalUrl}`,
    },
  });
});

// Centralized error handler
app.use(errorHandler);

// Start the database probe before accepting traffic.
const stopDbProbe = startDbProbe();

// Start server
const displayHost =
  config.HOST === '0.0.0.0' || config.HOST === '::' || config.HOST === '[::]'
    ? 'localhost'
    : config.HOST;
const server = app.listen(config.PORT, config.HOST, () => {
  logger.info(
    `🚀 PayPilot API server running on http://${displayHost}:${config.PORT}`
  );
  logger.info(
    `📡 Health endpoint available at http://localhost:${config.PORT}/api/health`
  );
  logger.info(`⚙️  Environment: ${config.NODE_ENV}`);
});

// Graceful shutdown handling
let shuttingDown = false;
const handleGracefulShutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  stopDbProbe();

  server.close(async () => {
    logger.info('HTTP server closed.');
    try {
      await prisma.$disconnect();
      logger.info('Database connection closed.');
    } catch (err) {
      logger.error('Error during database disconnect', err);
    }
    process.exit(0);
  });

  // Force close if graceful exit takes too long
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));

export default app;
