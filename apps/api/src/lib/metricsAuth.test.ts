import { after, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Request, Response } from 'express';
import { createMetricsAuthMiddleware, loadMetricsToken } from './metricsAuth';
import { logger } from './logger';

const token = 'test-metrics-token';

function fakeRes() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    set(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
}

describe('loadMetricsToken', () => {
  let dir: string;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paypilot-metrics-'));
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads and trims a token file', () => {
    const file = path.join(dir, 'token');
    fs.writeFileSync(file, `  ${token}\n`);
    assert.equal(loadMetricsToken(file), token);
  });

  it('throws when the file is missing', () => {
    assert.throws(() => loadMetricsToken(path.join(dir, 'missing')), /Unable to read/);
  });

  it('throws when the file is empty', () => {
    const file = path.join(dir, 'empty');
    fs.writeFileSync(file, '   \n');
    assert.throws(() => loadMetricsToken(file), /empty/);
  });
});

describe('createMetricsAuthMiddleware', () => {
  it('calls next for the correct bearer token', () => {
    const middleware = createMetricsAuthMiddleware(token);
    const req = {
      header: (name: string) =>
        name.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined,
      method: 'GET',
      path: '/metrics',
    } as unknown as Request;
    const res = fakeRes();
    let nextCalled = false;

    middleware(req, res as unknown as Response, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
  });

  it('matches the Bearer scheme case-insensitively', () => {
    const middleware = createMetricsAuthMiddleware(token);
    const req = {
      header: () => `bearer ${token}`,
      method: 'GET',
      path: '/metrics',
    } as unknown as Request;
    const res = fakeRes();
    let nextCalled = false;

    middleware(req, res as unknown as Response, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
  });

  it('returns 401 with WWW-Authenticate for a missing token', () => {
    const middleware = createMetricsAuthMiddleware(token);
    const req = {
      header: () => undefined,
      method: 'GET',
      path: '/metrics',
    } as unknown as Request;
    const res = fakeRes();
    let nextCalled = false;

    middleware(req, res as unknown as Response, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.headers['WWW-Authenticate'], 'Bearer');
  });

  it('returns 401 for a wrong token', () => {
    const middleware = createMetricsAuthMiddleware(token);
    const req = {
      header: () => 'Bearer wrong-token',
      method: 'GET',
      path: '/metrics',
    } as unknown as Request;
    const res = fakeRes();

    middleware(req, res as unknown as Response, () => undefined);

    assert.equal(res.statusCode, 401);
    assert.equal(res.headers['WWW-Authenticate'], 'Bearer');
  });

  it('never writes the token to the logger', () => {
    const debugSpy = mock.method(logger, 'debug', () => undefined);
    const middleware = createMetricsAuthMiddleware(token);
    const req = {
      header: () => 'Bearer wrong-token',
      method: 'GET',
      path: '/metrics',
    } as unknown as Request;
    const res = fakeRes();

    middleware(req, res as unknown as Response, () => undefined);

    const serialized = JSON.stringify(debugSpy.mock.calls);
    assert.equal(serialized.includes(token), false);
    assert.equal(serialized.includes('wrong-token'), false);
    debugSpy.mock.restore();
  });
});
