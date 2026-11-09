import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { LeaveType } from '@prisma/client';
import { Request, Response } from 'express';
import {
  HTTP_DURATION_BUCKETS,
  createHttpMetricsMiddleware,
  initializeBusinessMetricSeries,
  isMetricsExcludedPath,
  normalizeMethod,
  normalizeRoute,
  onRequestSuccess,
  register,
} from './metrics';

function fakeReq(
  overrides: {
    method?: string;
    path?: string;
    baseUrl?: string;
    route?: { path: unknown } | undefined;
  } = {}
): Request {
  return {
    method: overrides.method ?? 'GET',
    path: overrides.path ?? '/api/employees',
    baseUrl: overrides.baseUrl ?? '/api',
    route: 'route' in overrides ? overrides.route : { path: '/employees' },
  } as unknown as Request;
}

function fakeRes() {
  const res = new EventEmitter() as EventEmitter & { statusCode: number };
  res.statusCode = 200;
  return res;
}

async function metricText(name: string): Promise<string> {
  return register.getSingleMetricAsString(name);
}

function countSample(text: string, sample: string): number {
  const line = text
    .split('\n')
    .find((candidate) => candidate.startsWith(`${sample} `));
  return line ? Number(line.slice(sample.length + 1)) : 0;
}

function sumSamples(text: string, metricName: string): number {
  return text
    .split('\n')
    .filter(
      (line) =>
        line.startsWith(`${metricName}{`) || line.startsWith(`${metricName} `)
    )
    .reduce(
      (sum, line) => sum + Number(line.slice(line.lastIndexOf(' ') + 1)),
      0
    );
}

beforeEach(() => {
  register.resetMetrics();
  initializeBusinessMetricSeries();
});

describe('metric definitions', () => {
  it('registers the HTTP, business, and database metrics', async () => {
    for (const name of [
      'paypilot_http_requests_total',
      'paypilot_http_request_duration_seconds',
      'paypilot_http_requests_in_flight',
      'paypilot_attendance_punches_total',
      'paypilot_leave_requests_created_total',
      'paypilot_leave_reviews_total',
      'paypilot_payroll_imports_total',
      'paypilot_db_up',
      'paypilot_db_probe_duration_seconds',
      'paypilot_db_last_probe_timestamp_seconds',
    ]) {
      assert.ok(register.getSingleMetric(name), `${name} should be registered`);
    }

    assert.deepEqual(HTTP_DURATION_BUCKETS, [
      0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
    ]);
  });

  it('initializes every bounded business label combination at zero', async () => {
    const punches = await metricText('paypilot_attendance_punches_total');
    assert.match(punches, /action="in"/);
    assert.match(punches, /action="out"/);

    const leaveCreated = await metricText(
      'paypilot_leave_requests_created_total'
    );
    for (const leaveType of Object.values(LeaveType)) {
      assert.match(leaveCreated, new RegExp(`leave_type="${leaveType}"`));
    }

    const reviews = await metricText('paypilot_leave_reviews_total');
    assert.match(reviews, /decision="approve"/);
    assert.match(reviews, /decision="reject"/);

    const imports = await metricText('paypilot_payroll_imports_total');
    assert.match(imports, /status="COMPLETED"/);
    assert.match(imports, /status="FAILED"/);
  });
});

describe('normalization', () => {
  it('passes through known methods and maps unknown methods to OTHER', () => {
    assert.equal(normalizeMethod('GET'), 'GET');
    assert.equal(normalizeMethod('delete'), 'DELETE');
    assert.equal(normalizeMethod('TRACE'), 'OTHER');
    assert.equal(normalizeMethod('PROPFIND'), 'OTHER');
  });

  it('builds route labels from Express route patterns', () => {
    assert.equal(
      normalizeRoute(fakeReq({ baseUrl: '/api/attendance', route: { path: '/' } })),
      '/api/attendance'
    );
    assert.equal(
      normalizeRoute(
        fakeReq({ baseUrl: '/api/attendance', route: { path: '/punch' } })
      ),
      '/api/attendance/punch'
    );
    assert.equal(
      normalizeRoute(
        fakeReq({
          baseUrl: '/api/leave-requests',
          route: { path: '/:id/review' },
        })
      ),
      '/api/leave-requests/:id/review'
    );
  });

  it('normalizes duplicate and trailing slashes', () => {
    assert.equal(
      normalizeRoute(
        fakeReq({ baseUrl: '/api//employees', route: { path: '/' } })
      ),
      '/api/employees'
    );
  });

  it('falls back to unmatched when no route matched or the path is not a string', () => {
    assert.equal(normalizeRoute(fakeReq({ route: undefined })), 'unmatched');
    assert.equal(normalizeRoute(fakeReq({ route: { path: 42 } })), 'unmatched');
  });
});

describe('exclusion', () => {
  it('excludes /metrics and /api/health routes only', () => {
    assert.equal(isMetricsExcludedPath('/metrics'), true);
    assert.equal(isMetricsExcludedPath('/api/health'), true);
    assert.equal(isMetricsExcludedPath('/api/health/db'), true);
    assert.equal(isMetricsExcludedPath('/api/employees'), false);
    assert.equal(isMetricsExcludedPath('/api/healthcheck'), false);
  });
});

describe('HTTP metrics middleware', () => {
  it('records a completed request and leaves the in-flight gauge at zero', async () => {
    const middleware = createHttpMetricsMiddleware();
    const req = fakeReq();
    const res = fakeRes();
    let nextCalled = false;

    middleware(req, res as unknown as Response, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);

    const inFlight = await metricText('paypilot_http_requests_in_flight');
    assert.equal(
      countSample(inFlight, 'paypilot_http_requests_in_flight'),
      1
    );

    res.emit('finish');

    const after = await metricText('paypilot_http_requests_in_flight');
    assert.equal(countSample(after, 'paypilot_http_requests_in_flight'), 0);

    const counter = await metricText('paypilot_http_requests_total');
    assert.match(
      counter,
      /method="GET",route="\/api\/employees",status="200"\} 1/
    );

    const histogram = await metricText(
      'paypilot_http_request_duration_seconds'
    );
    assert.match(
      histogram,
      /paypilot_http_request_duration_seconds_count\{method="GET",route="\/api\/employees",status="200"\} 1/
    );
  });

  it('decrements once for an aborted request without counting it', async () => {
    const middleware = createHttpMetricsMiddleware();
    const req = fakeReq();
    const res = fakeRes();

    middleware(req, res as unknown as Response, () => undefined);
    res.emit('close');

    const inFlight = await metricText('paypilot_http_requests_in_flight');
    assert.equal(countSample(inFlight, 'paypilot_http_requests_in_flight'), 0);

    const counter = await metricText('paypilot_http_requests_total');
    assert.equal(
      sumSamples(counter, 'paypilot_http_requests_total'),
      0
    );

    const histogram = await metricText(
      'paypilot_http_request_duration_seconds'
    );
    assert.equal(
      sumSamples(
        histogram,
        'paypilot_http_request_duration_seconds_count'
      ),
      0
    );
  });

  it('decrements only once when finish is followed by close', async () => {
    const middleware = createHttpMetricsMiddleware();
    const req = fakeReq();
    const res = fakeRes();

    middleware(req, res as unknown as Response, () => undefined);
    res.emit('finish');
    res.emit('close');

    const inFlight = await metricText('paypilot_http_requests_in_flight');
    assert.equal(countSample(inFlight, 'paypilot_http_requests_in_flight'), 0);

    const counter = await metricText('paypilot_http_requests_total');
    assert.equal(
      sumSamples(counter, 'paypilot_http_requests_total'),
      1
    );
  });

  it('does not touch metrics for excluded paths', async () => {
    const middleware = createHttpMetricsMiddleware();
    const req = fakeReq({ path: '/api/health/db' });
    const res = fakeRes();

    middleware(req, res as unknown as Response, () => undefined);

    const inFlight = await metricText('paypilot_http_requests_in_flight');
    assert.equal(countSample(inFlight, 'paypilot_http_requests_in_flight'), 0);

    res.emit('finish');
    const counter = await metricText('paypilot_http_requests_total');
    assert.equal(
      sumSamples(counter, 'paypilot_http_requests_total'),
      0
    );
  });
});

describe('onRequestSuccess', () => {
  it('runs the callback for 2xx and 3xx responses', () => {
    for (const statusCode of [200, 201, 302]) {
      const res = fakeRes();
      res.statusCode = statusCode;
      const req = { res } as unknown as Request;
      let calls = 0;

      onRequestSuccess(req, () => {
        calls += 1;
      });
      res.emit('finish');

      assert.equal(calls, 1, `status ${statusCode}`);
    }
  });

  it('does not run the callback for 4xx and 5xx responses', () => {
    for (const statusCode of [400, 500]) {
      const res = fakeRes();
      res.statusCode = statusCode;
      const req = { res } as unknown as Request;
      let calls = 0;

      onRequestSuccess(req, () => {
        calls += 1;
      });
      res.emit('finish');

      assert.equal(calls, 0, `status ${statusCode}`);
    }
  });
});
