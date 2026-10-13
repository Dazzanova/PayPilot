import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { apiRouter } from './index';
import { errorHandler } from '../middleware/errorHandler';

describe('PayPilot API Route Verification & Regression Tests', () => {
  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use('/api', apiRouter);
    app.use((req, res) => {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Cannot ${req.method} ${req.originalUrl}`,
        },
      });
    });
    app.use(errorHandler);

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          baseUrl = `http://localhost:${address.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  test('GET /api returns PayPilot banner and service metadata', async () => {
    const res = await fetch(`${baseUrl}/api`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.message, 'PayPilot HRMS & Payroll API Service');
    assert.equal(body.version, '0.1.0');
  });

  test('GET /api/health returns healthy status with paypilot-api service name', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.status, 'healthy');
    assert.equal(body.data.service, 'paypilot-api');
    assert.equal(typeof body.data.uptimeSeconds, 'number');
  });

  test('GET /api/health/db reports disconnected/503 when live DB is unavailable without crashing', async () => {
    const res = await fetch(`${baseUrl}/api/health/db`);
    // When no DB server is active, it must safely return 503 with diagnostic payload
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'DATABASE_UNAVAILABLE');
    assert.equal(body.data.database, 'disconnected');
  });

  test('Undefined routes return standardized 404 JSON', async () => {
    const res = await fetch(`${baseUrl}/api/unknown-endpoint-test`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'NOT_FOUND');
  });
});
