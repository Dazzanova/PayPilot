import express from 'express';
import cors from 'cors';
import { config } from './config/env';
import { logger } from './lib/logger';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';
import { apiRouter } from './routes';
import { prisma } from './lib/prisma';

const app = express();

// Security and utility middlewares
app.use(
  cors({
    origin: config.CORS_ORIGIN,
    credentials: true,
  })
);
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

// Start server
const server = app.listen(config.PORT, () => {
  logger.info(`🚀 PayPilot API server running on port ${config.PORT}`);
  logger.info(`📡 Health endpoint available at http://localhost:${config.PORT}/api/health`);
  logger.info(`⚙️  Environment: ${config.NODE_ENV}`);
});

// Graceful shutdown handling
const handleGracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

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
