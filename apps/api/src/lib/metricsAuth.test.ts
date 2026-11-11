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

function fakeReq(authorization?: string): Request {
  return {
    header: (name: string) =>
      name.toLowerCase() === 'authorization' ? authorization : undefined,
    method: 'GET',
    path: '/metrics',
  } as unknown as Request;
}

function stubLogger() {
  const spies = {
    debug: mock.method(logger, 'debug', () => undefined),
    warn: mock.method(logger, 'warn', () => undefined),
    info: mock.method(logger, 'info', () => undefined),
    error: mock.method(logger, 'error', () => undefined),
  };

  return () => {
    for (const spy of Object.values(spies)) spy.mock.restore();
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

  it('throws when the token contains whitespace', () => {
    const file = path.join(dir, 'multiline');
    fs.writeFileSync(file, 'first-token\nsecond-token\n');
    assert.throws(() => loadMetricsToken(file), /without whitespace/);
  });
});

describe('createMetricsAuthMiddleware', () => {
  it('throws when the expected token is empty', () => {
    assert.throws(() => createMetricsAuthMiddleware('   '), /must not be empty/);
  });

  it('calls next for the correct bearer token', () => {
    const middleware = createMetricsAuthMiddleware(token);
    const res = fakeRes();
    let nextCalled = false;

    middleware(fakeReq(`Bearer ${token}`), res as unknown as Response, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
  });

  it('matches the Bearer scheme case-insensitively', () => {
    const middleware = createMetricsAuthMiddleware(token);
    const res = fakeRes();
    let nextCalled = false;

    middleware(fakeReq(`bearer ${token}`), res as unknown as Response, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
  });

  it('accepts tab and multiple-space separators and trailing whitespace', () => {
    const middleware = createMetricsAuthMiddleware(token);

    for (const header of [
      `Bearer\t${token}`,
      `Bearer   ${token}`,
      `Bearer ${token}   `,
    ]) {
      const res = fakeRes();
      let nextCalled = false;

      middleware(fakeReq(header), res as unknown as Response, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, true, header);
    }
  });

  it('returns 401 with WWW-Authenticate and the error envelope for a missing token', () => {
    const restoreLogger = stubLogger();
    const middleware = createMetricsAuthMiddleware(token);
    const res = fakeRes();
    let nextCalled = false;

    try {
      middleware(fakeReq(undefined), res as unknown as Response, () => {
        nextCalled = true;
      });
    } finally {
      restoreLogger();
    }

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.headers['WWW-Authenticate'], 'Bearer');
    assert.deepEqual(res.body, {
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or missing metrics token',
      },
    });
  });

  it('returns 401 for a wrong token', () => {
    const restoreLogger = stubLogger();
    const middleware = createMetricsAuthMiddleware(token);
    const res = fakeRes();

    try {
      middleware(fakeReq('Bearer wrong-token'), res as unknown as Response, () => undefined);
    } finally {
      restoreLogger();
    }

    assert.equal(res.statusCode, 401);
    assert.equal(res.headers['WWW-Authenticate'], 'Bearer');
  });

  it('rejects malformed authorization headers', () => {
    const restoreLogger = stubLogger();
    const middleware = createMetricsAuthMiddleware(token);

    try {
      for (const header of ['', 'Bearer', `Bearer ${token} extra`]) {
        const res = fakeRes();
        let nextCalled = false;

        middleware(fakeReq(header), res as unknown as Response, () => {
          nextCalled = true;
        });

        assert.equal(nextCalled, false, header);
        assert.equal(res.statusCode, 401, header);
      }
    } finally {
      restoreLogger();
    }
  });

  it('never writes the token to any logger level', () => {
    const restoreLogger = stubLogger();
    const spies = ['debug', 'warn', 'info', 'error'] as const;
    const middleware = createMetricsAuthMiddleware(token);
    const res = fakeRes();

    try {
      middleware(fakeReq('Bearer wrong-token'), res as unknown as Response, () => undefined);
    } finally {
      const serialized = JSON.stringify(
        spies.map((level) => (logger[level] as unknown as { mock?: { calls: unknown[] } }).mock?.calls ?? [])
      );
      restoreLogger();

      assert.equal(serialized.includes(token), false);
      assert.equal(serialized.includes('wrong-token'), false);
    }
  });
});
