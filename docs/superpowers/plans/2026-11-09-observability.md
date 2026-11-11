# PayPilot Observability Implementation Plan

**Status:** Ready for execution 2026-11-09
**Branch:** `feat/observability`
**Spec:** `docs/superpowers/specs/2026-11-09-observability-design.md` (Approved 2026-11-09)
**Goal:** Add a token-protected `/metrics` endpoint to the host-run API, instrument HTTP/business/DB health metrics, and provision Prometheus plus Grafana in the existing Docker Compose stack.

---

## How to use this plan

- Work from the repository root: `/home/dazzanova/project/course_projects/Payroll`.
- Stay on `feat/observability`. Do not create a new branch.
- Preserve the unrelated uncommitted web changes in `apps/web/src/pages/DashboardPage.tsx`, `DepartmentsPage.tsx`, and `SettingsPage.tsx`. Never stage or commit them.
- Follow TDD: write the failing test, run it, implement, run it again, then commit.
- Use `docker-compose` (standalone v5.6.0). `docker compose` is unavailable in this environment.
- Every command block is run from the repository root unless stated otherwise.
- Commit after every task using the commit message shown.

### Preconditions

```bash
git branch --show-current          # feat/observability
git status --short                 # only the three unrelated web files, if any
node --version                     # v24.x
docker --version                   # 29.x
docker-compose version             # v5.6.0
```

If `git status` shows anything else, stop and ask before proceeding.

---

## File map

| File | Action |
|---|---|
| `apps/api/package.json`, `package-lock.json` | Add `@prometheus-io/client@0.16.1` |
| `apps/api/src/config/env.ts` | Add `HOST`, `METRICS_TOKEN_FILE`, `REPO_ROOT`, `resolveRepoPath` |
| `apps/api/src/lib/metrics.ts` | New registry, metric definitions, normalization, HTTP middleware, business helper, metrics handler |
| `apps/api/src/lib/metrics.test.ts` | New unit tests for metrics |
| `apps/api/src/lib/metricsAuth.ts` | New token loader and constant-time bearer middleware |
| `apps/api/src/lib/metricsAuth.test.ts` | New unit tests for metrics auth |
| `apps/api/src/lib/dbProbe.ts` | New 15s non-overlapping database probe |
| `apps/api/src/lib/dbProbe.test.ts` | New unit tests for the probe |
| `apps/api/src/server.ts` | Wire `/metrics`, HTTP metrics, `HOST`, and probe lifecycle |
| `apps/api/src/features/attendance/attendance.routes.ts` | Add punch business counter hook |
| `apps/api/src/features/leave/leave.routes.ts` | Add leave create/review hooks |
| `apps/api/src/features/payrollImport/payrollImport.routes.ts` | Add import outcome hook |
| `apps/api/src/features/attendance/attendanceLeave.integration.test.ts` | Add metrics harness and assertions |
| `docker-compose.yml` | Add Prometheus/Grafana services, volumes, metrics-token secret |
| `docker/prometheus/prometheus.yml` | New scrape config |
| `docker/prometheus/alerts.yml` | New alert rules |
| `docker/prometheus/tests/alerts.test.yml` | New `promtool test rules` cases |
| `docker/grafana/provisioning/datasources/prometheus.yml` | New datasource provisioning |
| `docker/grafana/provisioning/dashboards/paypilot.yml` | New dashboard provider |
| `docker/grafana/dashboards/api-overview.json` | New API Overview dashboard |
| `docker/grafana/dashboards/business-activity.json` | New Business Activity dashboard |
| `.gitignore` | Ignore `.secrets/` |
| `.env.example` | Document new variables |
| `README.md` | Add Observability section and env rows |
| `docs/OBSERVABILITY.md` | New metric/dashboard/alert/security runbook |

No schema or migration changes.

---

## Task 1: Add the Prometheus client dependency

**Files:** `apps/api/package.json`, `package-lock.json`

1. Install the maintained package, not `prom-client`:

```bash
npm install @prometheus-io/client@0.16.1 --workspace=apps/api
```

2. Confirm the package resolves and is CommonJS with named exports:

```bash
node -e "const p=require('@prometheus-io/client'); console.log(typeof p.Registry, typeof p.Counter, typeof p.Histogram, typeof p.Gauge, typeof p.collectDefaultMetrics)"
```

Expected output:

```text
function function function function function
```

3. Confirm `apps/api/package.json` lists `"@prometheus-io/client": "^0.16.1"` under `dependencies` and does **not** list `prom-client`.

4. Commit:

```bash
git add apps/api/package.json package-lock.json
git commit -m "chore(api): add @prometheus-io/client"
```

---

## Task 2: Add `HOST`, metrics token path, and repo-root resolution

**Files:** `apps/api/src/config/env.ts`

1. Add `HOST` and `METRICS_TOKEN_FILE` to `envSchema`:

```ts
  HOST: z.string().min(1).default('0.0.0.0'),
  METRICS_TOKEN_FILE: z.string().min(1).default('./.secrets/paypilot_metrics_token'),
```

2. Add the repo-root helper below the schema:

```ts
// __dirname is apps/api/src/config in development and apps/api/dist/config in
// production builds. Four levels up is the repository root in both cases.
export const REPO_ROOT = path.resolve(__dirname, '../../../..');

export function resolveRepoPath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(REPO_ROOT, filePath);
}
```

3. Add the two fields to the `NODE_ENV=test` fallback object so its type still matches `Config`:

```ts
      HOST: process.env.HOST ?? '0.0.0.0',
      METRICS_TOKEN_FILE:
        process.env.METRICS_TOKEN_FILE ?? './.secrets/paypilot_metrics_token',
```

4. Create `apps/api/src/config/env.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { REPO_ROOT, resolveRepoPath } from './env';

describe('resolveRepoPath', () => {
  it('resolves relative paths from the repository root', () => {
    assert.equal(
      resolveRepoPath('./.secrets/paypilot_metrics_token'),
      path.join(REPO_ROOT, '.secrets/paypilot_metrics_token')
    );
  });

  it('keeps absolute paths unchanged', () => {
    assert.equal(resolveRepoPath('/tmp/metrics-token'), '/tmp/metrics-token');
  });
});
```

5. Run the focused test:

```bash
npm test --workspace=apps/api
```

6. Typecheck:

```bash
npm run typecheck --workspace=apps/api
```

7. Commit:

```bash
git add apps/api/src/config/env.ts apps/api/src/config/env.test.ts
git commit -m "feat(api): add host and metrics token configuration"
```

---

## Task 3: Write the failing metrics tests

**Files:** `apps/api/src/lib/metrics.test.ts`

Create the file with the full suite below. The module under test does not exist yet, so this run must fail.

```ts
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
      /method="GET",route="\/api\/employees",status="200" 1/
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
```

Run it and confirm it fails because `./metrics` cannot be resolved:

```bash
npm test --workspace=apps/api
```

---

## Task 4: Implement `apps/api/src/lib/metrics.ts`

**Files:** `apps/api/src/lib/metrics.ts`

Create the module with exactly this content:

```ts
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from '@prometheus-io/client';
import { LeaveType } from '@prisma/client';
import { NextFunction, Request, Response } from 'express';

export const register = new Registry();

collectDefaultMetrics({ register, prefix: 'paypilot_' });

// http_duration_buckets_v1. Changing these buckets changes p50/p95/p99 in the
// dashboards and alerts. Update dashboards, alert queries, and rule tests in the
// same change, then bump this version comment.
export const HTTP_DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

export const httpRequestsTotal = new Counter({
  name: 'paypilot_http_requests_total',
  help: 'Total completed HTTP requests.',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [register],
});

export const httpRequestDuration = new Histogram({
  name: 'paypilot_http_request_duration_seconds',
  help: 'HTTP request duration in seconds.',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: HTTP_DURATION_BUCKETS,
  registers: [register],
});

export const httpRequestsInFlight = new Gauge({
  name: 'paypilot_http_requests_in_flight',
  help: 'Current in-flight HTTP requests.',
  registers: [register],
});

export const attendancePunchesTotal = new Counter({
  name: 'paypilot_attendance_punches_total',
  help: 'Committed attendance punches by action.',
  labelNames: ['action'] as const,
  registers: [register],
});

export const leaveRequestsCreatedTotal = new Counter({
  name: 'paypilot_leave_requests_created_total',
  help: 'Committed leave requests by leave type.',
  labelNames: ['leave_type'] as const,
  registers: [register],
});

export const leaveReviewsTotal = new Counter({
  name: 'paypilot_leave_reviews_total',
  help: 'Committed leave reviews by decision.',
  labelNames: ['decision'] as const,
  registers: [register],
});

export const payrollImportsTotal = new Counter({
  name: 'paypilot_payroll_imports_total',
  help: 'Persisted payroll import batches by status.',
  labelNames: ['status'] as const,
  registers: [register],
});

export const dbUp = new Gauge({
  name: 'paypilot_db_up',
  help: '1 when the most recent database probe succeeded, 0 otherwise.',
  registers: [register],
});

export const dbProbeDuration = new Gauge({
  name: 'paypilot_db_probe_duration_seconds',
  help: 'Duration of the most recent database probe in seconds.',
  registers: [register],
});

export const dbLastProbeTimestamp = new Gauge({
  name: 'paypilot_db_last_probe_timestamp_seconds',
  help: 'Unix timestamp of the most recent completed database probe attempt.',
  registers: [register],
});

dbUp.set(0);
dbProbeDuration.set(0);
dbLastProbeTimestamp.set(0);

const KNOWN_METHODS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);

export function normalizeMethod(method: string): string {
  const upper = method.toUpperCase();
  return KNOWN_METHODS.has(upper) ? upper : 'OTHER';
}

export function normalizeRoute(req: Request): string {
  const routePath: unknown = req.route?.path;
  if (typeof routePath !== 'string') {
    return 'unmatched';
  }

  const combined = `${req.baseUrl ?? ''}/${routePath}`;
  const normalized = combined.replace(/\/{2,}/g, '/');
  if (normalized.length > 1 && normalized.endsWith('/')) {
    return normalized.slice(0, -1);
  }
  return normalized || '/';
}

export function isMetricsExcludedPath(pathName: string): boolean {
  return (
    pathName === '/metrics' ||
    pathName === '/api/health' ||
    pathName.startsWith('/api/health/')
  );
}

export function initializeBusinessMetricSeries(): void {
  for (const action of ['in', 'out'] as const) {
    attendancePunchesTotal.inc({ action }, 0);
  }
  for (const leaveType of Object.values(LeaveType)) {
    leaveRequestsCreatedTotal.inc({ leave_type: leaveType }, 0);
  }
  for (const decision of ['approve', 'reject'] as const) {
    leaveReviewsTotal.inc({ decision }, 0);
  }
  for (const status of ['COMPLETED', 'FAILED'] as const) {
    payrollImportsTotal.inc({ status }, 0);
  }
}

export function createHttpMetricsMiddleware() {
  return function httpMetricsMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    if (isMetricsExcludedPath(req.path)) {
      next();
      return;
    }

    httpRequestsInFlight.inc();
    const startedAt = process.hrtime.bigint();
    let settled = false;

    const settleGauge = () => {
      if (settled) return;
      settled = true;
      httpRequestsInFlight.dec();
    };

    res.on('finish', () => {
      settleGauge();
      const method = normalizeMethod(req.method);
      const route = normalizeRoute(req);
      const status = String(res.statusCode);
      const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;

      httpRequestsTotal.inc({ method, route, status });
      httpRequestDuration.observe({ method, route, status }, seconds);
    });

    res.on('close', () => {
      settleGauge();
    });

    next();
  };
}

export function onRequestSuccess(req: Request, callback: () => void): void {
  const res = req.res;
  if (!res) return;

  res.on('finish', () => {
    if (res.statusCode >= 200 && res.statusCode < 400) {
      callback();
    }
  });
}

export function metricsHandler(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  register
    .metrics()
    .then((body) => {
      res.set('Content-Type', register.contentType);
      res.set('Cache-Control', 'no-store');
      res.set('X-Content-Type-Options', 'nosniff');
      res.status(200).send(body);
    })
    .catch(next);
}
```

Run the unit suite:

```bash
npm test --workspace=apps/api
```

All tests must pass. If the histogram assertion fails, inspect the metric output by temporarily adding `console.log(await metricText('paypilot_http_request_duration_seconds'))` to the failing test, then remove it.

Then typecheck and commit:

```bash
npm run typecheck --workspace=apps/api
git add apps/api/src/lib/metrics.ts apps/api/src/lib/metrics.test.ts
git commit -m "feat(api): add metrics registry, HTTP middleware, and business helpers"
```

> **Execution note (`da046e6`):** Code review found that Express resets `req.baseUrl` to `""` while an error unwinds to the app-level error handler, so the original `baseUrl`-based `normalizeRoute` labeled every 4xx/5xx without its mount prefix. The committed implementation reconstructs the label from `req.originalUrl` and the matched route pattern, strips query strings, and sanitizes dynamic-looking mount segments (UUID, numeric, 16+ hex, email) to `:param`. It also lowercases the exclusion check, accepts `string | undefined` in `normalizeMethod`, uses `res.once('finish')` in `onRequestSuccess`, and self-initializes the bounded business series at module load. The tests cover the error-unwinding, param-mount, query-string, and case-insensitive cases. Use the committed `metrics.ts` and `metrics.test.ts` as the source of truth for later tasks.

---

## Task 5: Add the non-overlapping database probe

**Files:** `apps/api/src/lib/dbProbe.ts`, `apps/api/src/lib/dbProbe.test.ts`

### 5.1 Write the failing test

Create `apps/api/src/lib/dbProbe.test.ts`:

```ts
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { DbProbeDeps, runDbProbe, startDbProbe } from './dbProbe';

interface ProbeCalls {
  up: number[];
  duration: number[];
  timestamp: number[];
  warnings: Array<{ message: string; meta?: unknown }>;
  debug: string[];
}

function makeDeps(
  overrides: Partial<DbProbeDeps> = {}
): DbProbeDeps & { calls: ProbeCalls } {
  const calls: ProbeCalls = {
    up: [],
    duration: [],
    timestamp: [],
    warnings: [],
    debug: [],
  };
  let now = 1_000;

  return {
    query: async () => undefined,
    setDbUp: (value) => calls.up.push(value),
    setDuration: (value) => calls.duration.push(value),
    setTimestamp: (value) => calls.timestamp.push(value),
    now: () => {
      now += 25;
      return now;
    },
    logWarn: (message, meta) => calls.warnings.push({ message, meta }),
    logDebug: (message) => calls.debug.push(message),
    timeoutMs: 1_000,
    calls,
    ...overrides,
  };
}

describe('runDbProbe', () => {
  it('sets db_up to 1 and records duration and timestamp on success', async () => {
    const deps = makeDeps();

    await runDbProbe(deps);

    assert.deepEqual(deps.calls.up, [1]);
    assert.equal(deps.calls.duration.length, 1);
    assert.equal(deps.calls.timestamp.length, 1);
    assert.equal(deps.calls.warnings.length, 0);
  });

  it('sets db_up to 0 and warns on failure without leaking the connection string', async () => {
    const deps = makeDeps({
      query: async () => {
        throw new Error(
          'connection refused for postgresql://user:secret@localhost:5433/paypilot'
        );
      },
    });

    await runDbProbe(deps);

    assert.deepEqual(deps.calls.up, [0]);
    assert.equal(deps.calls.duration.length, 1);
    assert.equal(deps.calls.timestamp.length, 1);
    assert.equal(deps.calls.warnings.length, 1);
    assert.match(deps.calls.warnings[0].message, /probe failed/i);
    const serialized = JSON.stringify(deps.calls.warnings);
    assert.equal(serialized.includes('postgresql://'), false);
    assert.equal(serialized.includes('secret'), false);
    assert.match(serialized, /\[redacted\]/);
  });

  it('sets db_up to 0 when the probe times out', async () => {
    const deps = makeDeps({
      query: () => new Promise(() => undefined),
      timeoutMs: 5,
    });

    await runDbProbe(deps);

    assert.deepEqual(deps.calls.up, [0]);
    assert.equal(deps.calls.duration.length, 1);
    assert.equal(deps.calls.timestamp.length, 1);
    assert.match(
      JSON.stringify(deps.calls.warnings),
      /timed out after 5ms/
    );
  });

  it('skips a second probe while the first is still running', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deps = makeDeps({ query: () => gate });

    const first = runDbProbe(deps);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await runDbProbe(deps);

    assert.equal(deps.calls.up.length, 0);
    assert.equal(deps.calls.debug.length, 1);
    assert.match(deps.calls.debug[0], /previous probe is still running/i);

    release();
    await first;
    assert.deepEqual(deps.calls.up, [1]);
  });
});

describe('startDbProbe', () => {
  it('runs once at startup and stops the interval', async () => {
    const deps = makeDeps();
    const clearIntervalSpy = mock.method(global, 'clearInterval');

    const stop = startDbProbe(deps);
    await new Promise((resolve) => setTimeout(resolve, 10));
    stop();

    assert.equal(deps.calls.up.length, 1);
    assert.equal(clearIntervalSpy.mock.callCount(), 1);

    clearIntervalSpy.mock.restore();
  });
});
```

Run it and confirm the module is missing:

```bash
npm test --workspace=apps/api
```

### 5.2 Implement the probe

Create `apps/api/src/lib/dbProbe.ts`:

```ts
import { logger } from './logger';
import {
  dbLastProbeTimestamp,
  dbProbeDuration,
  dbUp,
} from './metrics';
import { prisma } from './prisma';

export const DB_PROBE_INTERVAL_MS = 15_000;
export const DB_PROBE_TIMEOUT_MS = 2_000;

export interface DbProbeDeps {
  query: () => Promise<unknown>;
  setDbUp: (value: number) => void;
  setDuration: (seconds: number) => void;
  setTimestamp: (seconds: number) => void;
  now: () => number;
  logWarn: (message: string, meta?: unknown) => void;
  logDebug: (message: string, meta?: unknown) => void;
  timeoutMs: number;
}

const defaultDeps: DbProbeDeps = {
  query: async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL statement_timeout = 2000');
      await tx.$queryRawUnsafe('SELECT 1');
    });
  },
  setDbUp: (value) => dbUp.set(value),
  setDuration: (seconds) => dbProbeDuration.set(seconds),
  setTimestamp: (seconds) => dbLastProbeTimestamp.set(seconds),
  now: () => Date.now(),
  logWarn: (message, meta) => logger.warn(message, meta),
  logDebug: (message, meta) => logger.debug(message, meta),
  timeoutMs: DB_PROBE_TIMEOUT_MS,
};

let inFlight = false;

function sanitizeErrorMessage(message: string): string {
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]');
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Database probe timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export async function runDbProbe(
  deps: DbProbeDeps = defaultDeps
): Promise<void> {
  if (inFlight) {
    deps.logDebug('Skipping database probe because the previous probe is still running');
    return;
  }

  inFlight = true;
  const startedAt = deps.now();
  let connected = false;

  try {
    await withTimeout(deps.query(), deps.timeoutMs);
    connected = true;
  } catch (error) {
    const message = sanitizeErrorMessage(
      error instanceof Error ? error.message : 'Unknown database probe error'
    );
    deps.logWarn('Database probe failed', { message });
  } finally {
    const finishedAt = deps.now();
    deps.setDbUp(connected ? 1 : 0);
    deps.setDuration((finishedAt - startedAt) / 1000);
    deps.setTimestamp(finishedAt / 1000);
    inFlight = false;
  }
}

export function startDbProbe(deps: DbProbeDeps = defaultDeps): () => void {
  void runDbProbe(deps);

  const interval = setInterval(() => {
    void runDbProbe(deps);
  }, DB_PROBE_INTERVAL_MS);
  interval.unref();

  return () => clearInterval(interval);
}
```

Run the tests:

```bash
npm test --workspace=apps/api
```

Typecheck and commit:

```bash
npm run typecheck --workspace=apps/api
git add apps/api/src/lib/dbProbe.ts apps/api/src/lib/dbProbe.test.ts
git commit -m "feat(api): add non-overlapping database probe"
```

---

## Task 6: Add token loading and `/metrics` authentication

**Files:** `apps/api/src/lib/metricsAuth.ts`, `apps/api/src/lib/metricsAuth.test.ts`

### 6.1 Write the failing test

Create `apps/api/src/lib/metricsAuth.test.ts`:

```ts
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
```

Run it and confirm the module is missing:

```bash
npm test --workspace=apps/api
```

### 6.2 Implement the auth module

Create `apps/api/src/lib/metricsAuth.ts`:

```ts
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
  return token;
}

function digest(value: string): Buffer {
  return crypto.createHash('sha256').update(value).digest();
}

export function createMetricsAuthMiddleware(expectedToken: string) {
  const expectedDigest = digest(expectedToken);

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
```

Run the tests:

```bash
npm test --workspace=apps/api
```

Typecheck and commit:

```bash
npm run typecheck --workspace=apps/api
git add apps/api/src/lib/metricsAuth.ts apps/api/src/lib/metricsAuth.test.ts
git commit -m "feat(api): authenticate /metrics with a constant-time bearer token"
```

> **Execution note (`4982875`):** Code review found that the timeout wrapper rejected while the underlying probe query kept running, and that the overlap lock was released at timeout, so a stalled database would accumulate one orphaned query per interval. The committed probe keeps the lock until the underlying query settles, isolates state per `DbProbeDeps` via `createDbProbe`/`WeakMap`, catches metric-setter failures so the lock cannot wedge, attaches `.catch` to scheduled runs, and broadens error redaction. Tests now cover the post-timeout lock, a throwing setter, non-`Error` rejections, redaction of `postgres://` and `password=`, and interval refresh/stop using `node:test` mock timers. The auth middleware also rejects an empty expected token and a multi-line token file, and the tests cover header-parsing edge cases, the 401 body envelope, and all logger levels.

---

## Task 7: Hook business counters into committed routes

**Files:**
- `apps/api/src/features/attendance/attendance.routes.ts`
- `apps/api/src/features/leave/leave.routes.ts`
- `apps/api/src/features/payrollImport/payrollImport.routes.ts`

The business callback runs from `res.on('finish')` after `tenantRouteHandler` has committed. The callback must be registered **after** the service call succeeds and **before** returning the response.

### 7.1 Attendance punch

Add the import at the top of `attendance.routes.ts`:

```ts
import { attendancePunchesTotal, onRequestSuccess } from '../../lib/metrics';
```

Change the punch handler to:

```ts
  router.post(
    '/punch',
    requireRole(...ALL_ROLES),
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId } = actor(req);
      const input = parse(attendancePunchSchema, req.body);
      const record = await punchAttendance(tx, organizationId, userId, input);
      onRequestSuccess(req, () =>
        attendancePunchesTotal.inc({ action: input.action })
      );
      return { body: { success: true, data: { record } } };
    })
  );
```

### 7.2 Leave create and review

Add the import at the top of `leave.routes.ts`:

```ts
import {
  leaveRequestsCreatedTotal,
  leaveReviewsTotal,
  onRequestSuccess,
} from '../../lib/metrics';
```

Change the create handler to:

```ts
  router.post(
    '/',
    requireRole(...ALL_ROLES),
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId } = actor(req);
      const input = parse(leaveCreateSchema, req.body);
      const request = await createLeaveRequest(tx, organizationId, userId, input);
      onRequestSuccess(req, () =>
        leaveRequestsCreatedTotal.inc({ leave_type: input.leaveType })
      );
      return { status: 201, body: { success: true, data: { request } } };
    })
  );
```

Change the review handler to:

```ts
  router.patch(
    '/:id/review',
    requireRole(...HR_ROLES),
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId } = actor(req);
      const idResult = z.string().uuid().safeParse(req.params.id);
      if (!idResult.success) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid leave request id');
      }
      const input = parse(leaveReviewSchema, req.body);
      const request = await reviewLeaveRequest(
        tx,
        organizationId,
        userId,
        idResult.data,
        input
      );
      onRequestSuccess(req, () =>
        leaveReviewsTotal.inc({ decision: input.action })
      );
      return { body: { success: true, data: { request } } };
    })
  );
```

### 7.3 Payroll imports

Add the import at the top of `payrollImport.routes.ts`:

```ts
import { onRequestSuccess, payrollImportsTotal } from '../../lib/metrics';
```

Change the upload handler to:

```ts
  router.post(
    '/',
    express.raw({ type: ['text/csv', 'application/csv'], limit: MAX_FILE_BYTES }),
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId } = actor(req);
      if (!Buffer.isBuffer(req.body)) {
        throw new HttpError(
          400,
          'CSV_BODY_REQUIRED',
          'Send the payroll register as a text/csv request body'
        );
      }

      const batch = await importPayrollCsv(tx, {
        organizationId,
        userId,
        filename: decodeFilename(req.header('x-file-name')),
        buffer: req.body,
      });

      const importStatus = batch.status;
      if (importStatus === 'COMPLETED' || importStatus === 'FAILED') {
        onRequestSuccess(req, () =>
          payrollImportsTotal.inc({ status: importStatus })
        );
      }

      return {
        status: 201,
        location: `/api/payroll-imports/${batch.id}`,
        body: { success: true, data: { batch } },
      };
    })
  );
```

Run the existing unit suite and typecheck:

```bash
npm run typecheck --workspace=apps/api
npm test --workspace=apps/api
```

Commit:

```bash
git add apps/api/src/features/attendance/attendance.routes.ts apps/api/src/features/leave/leave.routes.ts apps/api/src/features/payrollImport/payrollImport.routes.ts
git commit -m "feat(api): emit business counters after committed route responses"
```

---

## Task 8: Add the metrics harness and assertions to the integration suite

**Files:** `apps/api/src/features/attendance/attendanceLeave.integration.test.ts`

This suite already owns the `aaaa`/`bbbb` fixture range. Do not add new fixture ranges.

### 8.1 Add imports and constants

Add these imports near the existing imports:

```ts
import { createHttpMetricsMiddleware, metricsHandler } from '../../lib/metrics';
import { createMetricsAuthMiddleware } from '../../lib/metricsAuth';
import { healthRouter } from '../../routes/health.routes';
```

Add the test token near the fixture constants:

```ts
const metricsToken = 'integration-metrics-token';
```

### 8.2 Mount the metrics harness

Replace the app setup inside `before` with:

```ts
  const app = express();

  // /metrics must bypass the HTTP metrics middleware and CORS.
  app.get('/metrics', createMetricsAuthMiddleware(metricsToken), metricsHandler);
  app.use(createHttpMetricsMiddleware());
  app.use(express.json());
  app.use('/api/health', healthRouter);
  app.use('/api/attendance', createAttendanceRouter(fakeAuth));
  app.use('/api/leave-requests', createLeaveRouter(fakeAuth));
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
```

### 8.3 Add metrics helpers

Add these helpers after the existing `api()` helper:

```ts
async function fetchMetrics(authorization?: string) {
  const response = await fetch(`${baseUrl}/metrics`, {
    headers: authorization ? { authorization } : {},
  });
  return { status: response.status, text: await response.text() };
}

function metricValue(text: string, sample: string): number {
  const line = text
    .split('\n')
    .find((candidate) => candidate.startsWith(`${sample} `));
  return line ? Number(line.slice(sample.length + 1)) : 0;
}
```

### 8.4 Add the metrics describe block

Insert this block **inside** the existing `describeDb('Attendance and leave integration', () => { ... })` block, immediately before its final closing `});`. The existing `after(...)` hook still runs after all tests.

```ts
describe('metrics endpoint', () => {
  it('requires a bearer token', async () => {
    const missing = await fetchMetrics();
    assert.equal(missing.status, 401);
    assert.equal(missing.text.includes('paypilot_http_requests_total'), false);

    const wrong = await fetchMetrics('Bearer wrong-token');
    assert.equal(wrong.status, 401);
  });

  it('increments business counters only for committed successful punches', async () => {
    const before = await fetchMetrics(`Bearer ${metricsToken}`);
    assert.equal(before.status, 200);
    const baseline = metricValue(
      before.text,
      'paypilot_attendance_punches_total{action="in"}'
    );

    const punch = await api('/api/attendance/punch', {
      method: 'POST',
      user: userEmployeeA2,
      body: { action: 'in', workDate: '2027-01-15' },
    });
    assert.equal(punch.status, 200, punch.text);

    const afterSuccess = await fetchMetrics(`Bearer ${metricsToken}`);
    assert.equal(
      metricValue(
        afterSuccess.text,
        'paypilot_attendance_punches_total{action="in"}'
      ),
      baseline + 1
    );

    const failed = await api('/api/attendance/punch', {
      method: 'POST',
      user: userEmployeeA2,
      body: { action: 'in', workDate: '2026-02-30' },
    });
    assert.equal(failed.status, 400);

    const afterFailure = await fetchMetrics(`Bearer ${metricsToken}`);
    assert.equal(
      metricValue(
        afterFailure.text,
        'paypilot_attendance_punches_total{action="in"}'
      ),
      baseline + 1
    );
  });

  it('excludes health routes and labels unknown routes as unmatched', async () => {
    await api('/api/health');
    await api('/api/health/db');

    const missing = await api('/api/does-not-exist');
    assert.equal(missing.status, 404);

    const metrics = await fetchMetrics(`Bearer ${metricsToken}`);
    assert.equal(metrics.text.includes('route="/api/health'), false);
    assert.match(metrics.text, /route="unmatched"/);
    assert.equal(metrics.text.includes('/api/does-not-exist'), false);
  });

  it('never labels raw URLs, UUIDs, or query strings', async () => {
    await api(`/api/attendance?employeeId=${employeeA2}&search=secret`, {
      user: userEmployeeA1,
    });

    const metrics = await fetchMetrics(`Bearer ${metricsToken}`);
    assert.equal(metrics.text.includes(employeeA2), false);
    assert.equal(metrics.text.includes('search=secret'), false);
  });
});
```

### 8.5 Run the integration suite

```bash
RUN_DB_INTEGRATION=1 npm run test:integration --workspace=apps/api
```

All tests must pass, including the new metrics block. The suite requires a reachable PostgreSQL and `DIRECT_URL` in the environment.

Typecheck the tests and commit:

```bash
npm run typecheck:tests --workspace=apps/api
git add apps/api/src/features/attendance/attendanceLeave.integration.test.ts
git commit -m "test(api): cover metrics auth, exclusions, and business counters"
```

---

## Task 9: Wire metrics, host binding, and the probe into `server.ts`

**Files:** `apps/api/src/server.ts`

Replace the file with:

```ts
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

const metricsToken = loadMetricsToken(
  resolveRepoPath(config.METRICS_TOKEN_FILE)
);
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
const server = app.listen(config.PORT, config.HOST, () => {
  logger.info(
    `🚀 PayPilot API server running on http://${config.HOST}:${config.PORT}`
  );
  logger.info(
    `📡 Health endpoint available at http://localhost:${config.PORT}/api/health`
  );
  logger.info(`⚙️  Environment: ${config.NODE_ENV}`);
});

// Graceful shutdown handling
const handleGracefulShutdown = async (signal: string) => {
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
```

Create the local token file before starting the API:

```bash
mkdir -p .secrets
chmod 700 .secrets
printf '%s' "$(openssl rand -hex 32)" > .secrets/paypilot_metrics_token
chmod 640 .secrets/paypilot_metrics_token
```

Smoke-test the endpoint in a background shell:

```bash
npm run dev --workspace=apps/api
```

In another shell:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4000/metrics
# 401

curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $(cat .secrets/paypilot_metrics_token)" \
  http://localhost:4000/metrics
# 200

curl -s \
  -H "Authorization: Bearer $(cat .secrets/paypilot_metrics_token)" \
  http://localhost:4000/metrics | grep -E '^paypilot_(http_requests_total|attendance_punches_total|db_up)'
```

Confirm the CORS header is absent:

```bash
curl -s -D - -o /dev/null \
  -H "Origin: http://localhost:5173" \
  -H "Authorization: Bearer $(cat .secrets/paypilot_metrics_token)" \
  http://localhost:4000/metrics | grep -i 'access-control-allow-origin' || echo 'no CORS header'
```

Stop the API, then typecheck and commit:

```bash
npm run typecheck --workspace=apps/api
git add apps/api/src/server.ts
git commit -m "feat(api): expose authenticated metrics and wire the DB probe"
```

> **Execution note (`4aa6bc9`, `e2fb876`):** Code review hardened startup and test coverage. `server.ts` now loads the token through `loadMetricsTokenOrExit()` so a missing token prints one actionable line and exits 1 instead of an uncaught stack trace; it also guards shutdown re-entry and logs `0.0.0.0`/`::` as `localhost`. The integration harness mounts `cors({ origin, credentials: true })` after `/metrics` and asserts a valid scrape carries no `access-control-allow-origin` while `/api/health` does. It also adds baseline+delta business-counter tests for leave create/review (including overlap and double-review 409s) and payroll `COMPLETED`/`FAILED` (including a rejected upload), plus a non-vacuous `route="unmatched",status="404"` assertion and a matched-route control. `.secrets/` is gitignored. Use the committed tests as the source of truth.

---

## Task 10: Add Prometheus to Docker Compose with rules and tests

**Files:**
- `docker-compose.yml`
- `docker/prometheus/prometheus.yml`
- `docker/prometheus/alerts.yml`
- `docker/prometheus/tests/alerts.test.yml`

### 10.1 Create the Prometheus configuration

Create `docker/prometheus/prometheus.yml`:

```yaml
global:
  scrape_interval: 15s
  scrape_timeout: 10s
  evaluation_interval: 15s

rule_files:
  - /etc/prometheus/alerts.yml

scrape_configs:
  - job_name: paypilot-api
    metrics_path: /metrics
    scheme: http
    authorization:
      type: Bearer
      credentials_file: /run/secrets/paypilot_metrics_token
    static_configs:
      - targets: ["host.docker.internal:4000"]
        labels:
          service: paypilot-api
          environment: local
```

### 10.2 Create the alert rules

Create `docker/prometheus/alerts.yml`:

```yaml
groups:
  - name: paypilot-api
    rules:
      - alert: PayPilotApiDown
        expr: up{job="paypilot-api"} == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "PayPilot API is not reachable by Prometheus"
          description: "Prometheus has failed to scrape the PayPilot API for 2 minutes."

      - alert: PayPilotHigh5xxRate
        expr: |
          (
            sum(rate(paypilot_http_requests_total{job="paypilot-api",status=~"5.."}[5m]))
            /
            clamp_min(sum(rate(paypilot_http_requests_total{job="paypilot-api"}[5m])), 1e-9)
          ) > 0.05
          and
          sum(increase(paypilot_http_requests_total{job="paypilot-api"}[5m])) >= 50
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "PayPilot API 5xx rate is above 5%"
          description: "The 5xx ratio has exceeded 5% for 10 minutes with at least 50 requests in the last 5 minutes."

      - alert: PayPilotHighP95Latency
        expr: |
          histogram_quantile(
            0.95,
            sum by (le) (rate(paypilot_http_request_duration_seconds_bucket{job="paypilot-api"}[5m]))
          ) > 1
          and
          sum(increase(paypilot_http_request_duration_seconds_count{job="paypilot-api"}[5m])) >= 50
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "PayPilot API p95 latency is above 1s"
          description: "The p95 request latency has exceeded 1s for 10 minutes with at least 50 requests in the last 5 minutes."

      - alert: PayPilotDatabaseDown
        expr: |
          paypilot_db_up{job="paypilot-api"} == 0
          and
          (time() - paypilot_db_last_probe_timestamp_seconds{job="paypilot-api"}) < 60
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "PayPilot database probe is failing"
          description: "The API's database probe has reported failure for 2 minutes."

      - alert: PayPilotDatabaseProbeStale
        expr: |
          (time() - paypilot_db_last_probe_timestamp_seconds{job="paypilot-api"}) > 60
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "PayPilot database probe is stale"
          description: "The API has not updated the database probe timestamp for more than 60 seconds."
```

### 10.3 Create the rule tests

Create `docker/prometheus/tests/alerts.test.yml`:

```yaml
rule_files:
  - /etc/prometheus/alerts.yml

evaluation_interval: 1m

tests:
  - interval: 1m
    input_series:
      - series: 'up{job="paypilot-api",instance="host.docker.internal:4000"}'
        values: '0x5'
    alert_rule_test:
      - eval_time: 2m
        alertname: PayPilotApiDown
        exp_alerts:
          - exp_labels:
              severity: critical
              job: paypilot-api
              instance: host.docker.internal:4000
            exp_annotations:
              summary: "PayPilot API is not reachable by Prometheus"
              description: "Prometheus has failed to scrape the PayPilot API for 2 minutes."

  - interval: 1m
    input_series:
      - series: 'paypilot_http_requests_total{job="paypilot-api",instance="host.docker.internal:4000",method="GET",route="/api/test",status="200"}'
        values: '0+100x20'
      - series: 'paypilot_http_requests_total{job="paypilot-api",instance="host.docker.internal:4000",method="GET",route="/api/test",status="500"}'
        values: '0+10x20'
    alert_rule_test:
      - eval_time: 20m
        alertname: PayPilotHigh5xxRate
        exp_alerts:
          - exp_labels:
              severity: warning
            exp_annotations:
              summary: "PayPilot API 5xx rate is above 5%"
              description: "The 5xx ratio has exceeded 5% for 10 minutes with at least 50 requests in the last 5 minutes."

  - interval: 1m
    input_series:
      - series: 'paypilot_http_requests_total{job="paypilot-api",instance="host.docker.internal:4000",method="GET",route="/api/test",status="200"}'
        values: '0+1x20'
      - series: 'paypilot_http_requests_total{job="paypilot-api",instance="host.docker.internal:4000",method="GET",route="/api/test",status="500"}'
        values: '0+1x20'
    alert_rule_test:
      - eval_time: 20m
        alertname: PayPilotHigh5xxRate
        exp_alerts: []

  - interval: 1m
    input_series:
      - series: 'paypilot_http_requests_total{job="paypilot-api",instance="host.docker.internal:4000",method="GET",route="/api/test",status="200"}'
        values: '0+100x20'
      - series: 'paypilot_http_requests_total{job="paypilot-api",instance="host.docker.internal:4000",method="GET",route="/api/test",status="500"}'
        values: '0+1x20'
    alert_rule_test:
      - eval_time: 20m
        alertname: PayPilotHigh5xxRate
        exp_alerts: []

  - interval: 1m
    input_series:
      - series: 'paypilot_http_request_duration_seconds_bucket{job="paypilot-api",instance="host.docker.internal:4000",le="0.5"}'
        values: '0+0x20'
      - series: 'paypilot_http_request_duration_seconds_bucket{job="paypilot-api",instance="host.docker.internal:4000",le="1"}'
        values: '0+0x20'
      - series: 'paypilot_http_request_duration_seconds_bucket{job="paypilot-api",instance="host.docker.internal:4000",le="2.5"}'
        values: '0+100x20'
      - series: 'paypilot_http_request_duration_seconds_bucket{job="paypilot-api",instance="host.docker.internal:4000",le="5"}'
        values: '0+100x20'
      - series: 'paypilot_http_request_duration_seconds_bucket{job="paypilot-api",instance="host.docker.internal:4000",le="10"}'
        values: '0+100x20'
      - series: 'paypilot_http_request_duration_seconds_bucket{job="paypilot-api",instance="host.docker.internal:4000",le="+Inf"}'
        values: '0+100x20'
      - series: 'paypilot_http_request_duration_seconds_count{job="paypilot-api",instance="host.docker.internal:4000"}'
        values: '0+100x20'
    alert_rule_test:
      - eval_time: 20m
        alertname: PayPilotHighP95Latency
        exp_alerts:
          - exp_labels:
              severity: warning
            exp_annotations:
              summary: "PayPilot API p95 latency is above 1s"
              description: "The p95 request latency has exceeded 1s for 10 minutes with at least 50 requests in the last 5 minutes."

  - interval: 1m
    input_series:
      - series: 'paypilot_http_request_duration_seconds_bucket{job="paypilot-api",instance="host.docker.internal:4000",le="0.5"}'
        values: '0+100x20'
      - series: 'paypilot_http_request_duration_seconds_bucket{job="paypilot-api",instance="host.docker.internal:4000",le="1"}'
        values: '0+100x20'
      - series: 'paypilot_http_request_duration_seconds_bucket{job="paypilot-api",instance="host.docker.internal:4000",le="2.5"}'
        values: '0+100x20'
      - series: 'paypilot_http_request_duration_seconds_bucket{job="paypilot-api",instance="host.docker.internal:4000",le="5"}'
        values: '0+100x20'
      - series: 'paypilot_http_request_duration_seconds_bucket{job="paypilot-api",instance="host.docker.internal:4000",le="10"}'
        values: '0+100x20'
      - series: 'paypilot_http_request_duration_seconds_bucket{job="paypilot-api",instance="host.docker.internal:4000",le="+Inf"}'
        values: '0+100x20'
      - series: 'paypilot_http_request_duration_seconds_count{job="paypilot-api",instance="host.docker.internal:4000"}'
        values: '0+100x20'
    alert_rule_test:
      - eval_time: 20m
        alertname: PayPilotHighP95Latency
        exp_alerts: []

  - interval: 1m
    input_series:
      - series: 'paypilot_http_request_duration_seconds_bucket{job="paypilot-api",instance="host.docker.internal:4000",le="0.5"}'
        values: '0+0x20'
      - series: 'paypilot_http_request_duration_seconds_bucket{job="paypilot-api",instance="host.docker.internal:4000",le="1"}'
        values: '0+0x20'
      - series: 'paypilot_http_request_duration_seconds_bucket{job="paypilot-api",instance="host.docker.internal:4000",le="2.5"}'
        values: '0+100x20'
      - series: 'paypilot_http_request_duration_seconds_bucket{job="paypilot-api",instance="host.docker.internal:4000",le="5"}'
        values: '0+100x20'
      - series: 'paypilot_http_request_duration_seconds_bucket{job="paypilot-api",instance="host.docker.internal:4000",le="10"}'
        values: '0+100x20'
      - series: 'paypilot_http_request_duration_seconds_bucket{job="paypilot-api",instance="host.docker.internal:4000",le="+Inf"}'
        values: '0+100x20'
      - series: 'paypilot_http_request_duration_seconds_count{job="paypilot-api",instance="host.docker.internal:4000"}'
        values: '0+1x20'
    alert_rule_test:
      - eval_time: 20m
        alertname: PayPilotHighP95Latency
        exp_alerts: []

  - interval: 1m
    input_series:
      - series: 'paypilot_db_up{job="paypilot-api",instance="host.docker.internal:4000"}'
        values: '0x20'
      - series: 'paypilot_db_last_probe_timestamp_seconds{job="paypilot-api",instance="host.docker.internal:4000"}'
        values: '0+60x20'
    alert_rule_test:
      - eval_time: 2m
        alertname: PayPilotDatabaseDown
        exp_alerts:
          - exp_labels:
              severity: critical
              job: paypilot-api
              instance: host.docker.internal:4000
            exp_annotations:
              summary: "PayPilot database probe is failing"
              description: "The API's database probe has reported failure for 2 minutes."

  - interval: 1m
    input_series:
      - series: 'paypilot_db_up{job="paypilot-api",instance="host.docker.internal:4000"}'
        values: '0x20'
      - series: 'paypilot_db_last_probe_timestamp_seconds{job="paypilot-api",instance="host.docker.internal:4000"}'
        values: '0x20'
    alert_rule_test:
      - eval_time: 2m
        alertname: PayPilotDatabaseDown
        exp_alerts: []
      - eval_time: 7m
        alertname: PayPilotDatabaseProbeStale
        exp_alerts:
          - exp_labels:
              severity: warning
              job: paypilot-api
              instance: host.docker.internal:4000
            exp_annotations:
              summary: "PayPilot database probe is stale"
              description: "The API has not updated the database probe timestamp for more than 60 seconds."
```

### 10.4 Add the Compose service and secret

In `docker-compose.yml`, add the Prometheus service after `keycloak`:

```yaml
  prometheus:
    image: prom/prometheus:v3.16.0
    container_name: paypilot-prometheus
    restart: unless-stopped
    # The secret is bind-mounted with the host file's owner/mode. Keep the token
    # at 0640 and add the host gid below so the image's "nobody" user can read
    # it; otherwise the scrape fails with "unable to read authorization
    # credentials" and the target goes down.
    group_add:
      - "${HOST_GID:-1000}"
    command:
      - --config.file=/etc/prometheus/prometheus.yml
      - --storage.tsdb.path=/prometheus
      - --storage.tsdb.retention.time=15d
      - --web.listen-address=0.0.0.0:9090
    ports:
      - "127.0.0.1:${PROMETHEUS_PORT:-9090}:9090"
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - paypilot-prometheus-data:/prometheus
      - ./docker/prometheus:/etc/prometheus:ro
    secrets:
      - paypilot_metrics_token
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:9090/-/ready >/dev/null || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 20s
```

Add the secret to the top-level `secrets` block and the volume to the top-level `volumes` block:

```yaml
volumes:
  paypilot-postgres-data:
  paypilot-keycloak-data:
  paypilot-prometheus-data:

secrets:
  paypilot_metrics_token:
    file: ./.secrets/paypilot_metrics_token
```

### 10.5 Validate the rules against the pinned image

Ensure the token file exists (Task 9), then:

```bash
docker-compose config >/dev/null
docker-compose up -d prometheus
until [ "$(docker inspect -f '{{.State.Health.Status}}' paypilot-prometheus)" = "healthy" ]; do sleep 1; done
docker-compose exec prometheus /bin/promtool check config /etc/prometheus/prometheus.yml
docker-compose exec prometheus /bin/promtool check rules /etc/prometheus/alerts.yml
docker-compose exec prometheus /bin/promtool test rules /etc/prometheus/tests/alerts.test.yml
```

Expected: `SUCCESS` for all three commands. `check config` must find `/run/secrets/paypilot_metrics_token`; if it does not, the Compose secret is misconfigured.

Verify the target:

```bash
curl -s http://localhost:9090/api/v1/targets | grep -o '"health":"[a-z]*"' | head
```

Expected: `"health":"up"`.

Commit:

```bash
git add docker-compose.yml docker/prometheus
git commit -m "feat(infra): add Prometheus with scrape config, alerts, and rule tests"
```

> **Execution note (`34d9328` and the follow-up permission commit):** Review found that a Compose file secret is bind-mounted with the host file's owner/mode, so the image's default `nobody` user could not read a `0600` token. The committed setup keeps the token at `0640`, keeps `.secrets/` at `0700`, and adds `group_add: ["${HOST_GID:-1000}"]` so `nobody` reads the token through the host gid without running the container as root and without making the token world-readable. The rule set also drops the unnecessary `clamp_min`, matches the DB rules with `and on (job, instance)`, and gates `PayPilotDatabaseProbeStale` on `up == 1` so it cannot fire alongside `PayPilotApiDown`. Tests add non-firing cases for `PayPilotApiDown`, zero 5xx series, fresh probe timestamps, and the stale-while-down guard, and use a valid latency histogram. Document `HOST_GID` alongside `PROMETHEUS_PORT` in Task 12.

---

## Task 11: Add Grafana with provisioned datasource and dashboards

**Files:**
- `docker-compose.yml`
- `docker/grafana/provisioning/datasources/prometheus.yml`
- `docker/grafana/provisioning/dashboards/paypilot.yml`
- `docker/grafana/dashboards/api-overview.json`
- `docker/grafana/dashboards/business-activity.json`

### 11.1 Add the Grafana service

Add this service to `docker-compose.yml` after `prometheus`:

```yaml
  grafana:
    image: grafana/grafana:13.2.5
    container_name: paypilot-grafana
    restart: unless-stopped
    environment:
      GF_SECURITY_ADMIN_USER: ${GRAFANA_ADMIN_USER:-admin}
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_ADMIN_PASSWORD:?GRAFANA_ADMIN_PASSWORD is required}
      GF_USERS_ALLOW_SIGN_UP: "false"
      GF_AUTH_ANONYMOUS_ENABLED: "false"
      GF_AUTH_DISABLE_LOGIN_FORM: "false"
      GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH: /var/lib/grafana/dashboards/api-overview.json
    ports:
      - "127.0.0.1:${GRAFANA_PORT:-3000}:3000"
    volumes:
      - paypilot-grafana-data:/var/lib/grafana
      - ./docker/grafana/provisioning:/etc/grafana/provisioning:ro
      - ./docker/grafana/dashboards:/var/lib/grafana/dashboards:ro
    depends_on:
      prometheus:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 20s
```

Add `paypilot-grafana-data` to the top-level `volumes` block:

```yaml
volumes:
  paypilot-postgres-data:
  paypilot-keycloak-data:
  paypilot-prometheus-data:
  paypilot-grafana-data:
```

### 11.2 Provision the datasource

Create `docker/grafana/provisioning/datasources/prometheus.yml`:

```yaml
apiVersion: 1

datasources:
  - name: Prometheus
    uid: paypilot-prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: false
    jsonData:
      timeInterval: 15s
```

### 11.3 Provision the dashboard folder

Create `docker/grafana/provisioning/dashboards/paypilot.yml`:

```yaml
apiVersion: 1

providers:
  - name: PayPilot
    orgId: 1
    folder: PayPilot
    type: file
    disableDeletion: true
    allowUiUpdates: false
    updateIntervalSeconds: 30
    options:
      path: /var/lib/grafana/dashboards
      foldersFromFilesStructure: false
```

### 11.4 Create the API Overview dashboard

Create `docker/grafana/dashboards/api-overview.json`:

```json
{
  "id": null,
  "uid": "paypilot-api-overview",
  "title": "PayPilot API Overview",
  "tags": ["paypilot", "api"],
  "timezone": "browser",
  "schemaVersion": 39,
  "version": 1,
  "refresh": "30s",
  "time": { "from": "now-6h", "to": "now" },
  "annotations": { "list": [] },
  "templating": {
    "list": [
      {
        "name": "route",
        "label": "Route",
        "type": "query",
        "datasource": { "type": "prometheus", "uid": "paypilot-prometheus" },
        "query": "label_values(paypilot_http_requests_total, route)",
        "includeAll": true,
        "multi": true,
        "refresh": 2,
        "current": { "text": "All", "value": "$__all" }
      }
    ]
  },
  "panels": [
    {
      "id": 1,
      "type": "stat",
      "title": "API target up",
      "datasource": { "type": "prometheus", "uid": "paypilot-prometheus" },
      "gridPos": { "h": 4, "w": 6, "x": 0, "y": 0 },
      "targets": [
        { "refId": "A", "expr": "up{job=\"paypilot-api\"}", "instant": true }
      ],
      "fieldConfig": {
        "defaults": {
          "mappings": [
            {
              "type": "value",
              "options": {
                "0": { "text": "DOWN", "color": "red" },
                "1": { "text": "UP", "color": "green" }
              }
            }
          ],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              { "color": "red", "value": null },
              { "color": "green", "value": 1 }
            ]
          }
        },
        "overrides": []
      },
      "options": {
        "reduceOptions": { "calcs": ["lastNotNull"], "fields": "", "values": false },
        "colorMode": "background",
        "graphMode": "none",
        "justifyMode": "auto",
        "orientation": "auto",
        "textMode": "auto"
      }
    },
    {
      "id": 2,
      "type": "stat",
      "title": "DB up",
      "datasource": { "type": "prometheus", "uid": "paypilot-prometheus" },
      "gridPos": { "h": 4, "w": 6, "x": 6, "y": 0 },
      "targets": [
        { "refId": "A", "expr": "paypilot_db_up{job=\"paypilot-api\"}", "instant": true }
      ],
      "fieldConfig": {
        "defaults": {
          "mappings": [
            {
              "type": "value",
              "options": {
                "0": { "text": "DOWN", "color": "red" },
                "1": { "text": "UP", "color": "green" }
              }
            }
          ],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              { "color": "red", "value": null },
              { "color": "green", "value": 1 }
            ]
          }
        },
        "overrides": []
      },
      "options": {
        "reduceOptions": { "calcs": ["lastNotNull"], "fields": "", "values": false },
        "colorMode": "background",
        "graphMode": "none",
        "justifyMode": "auto",
        "orientation": "auto",
        "textMode": "auto"
      }
    },
    {
      "id": 3,
      "type": "stat",
      "title": "Process uptime",
      "datasource": { "type": "prometheus", "uid": "paypilot-prometheus" },
      "gridPos": { "h": 4, "w": 6, "x": 12, "y": 0 },
      "targets": [
        {
          "refId": "A",
          "expr": "time() - paypilot_process_start_time_seconds{job=\"paypilot-api\"}",
          "instant": true
        }
      ],
      "fieldConfig": {
        "defaults": { "unit": "s" },
        "overrides": []
      },
      "options": {
        "reduceOptions": { "calcs": ["lastNotNull"], "fields": "", "values": false },
        "colorMode": "value",
        "graphMode": "none",
        "justifyMode": "auto",
        "orientation": "auto",
        "textMode": "auto"
      }
    },
    {
      "id": 4,
      "type": "stat",
      "title": "In-flight requests",
      "datasource": { "type": "prometheus", "uid": "paypilot-prometheus" },
      "gridPos": { "h": 4, "w": 6, "x": 18, "y": 0 },
      "targets": [
        {
          "refId": "A",
          "expr": "paypilot_http_requests_in_flight{job=\"paypilot-api\"}",
          "instant": true
        }
      ],
      "fieldConfig": { "defaults": { "unit": "short" }, "overrides": [] },
      "options": {
        "reduceOptions": { "calcs": ["lastNotNull"], "fields": "", "values": false },
        "colorMode": "value",
        "graphMode": "none",
        "justifyMode": "auto",
        "orientation": "auto",
        "textMode": "auto"
      }
    },
    {
      "id": 5,
      "type": "timeseries",
      "title": "Request rate by status",
      "datasource": { "type": "prometheus", "uid": "paypilot-prometheus" },
      "gridPos": { "h": 8, "w": 12, "x": 0, "y": 4 },
      "targets": [
        {
          "refId": "A",
          "expr": "sum by (status) (rate(paypilot_http_requests_total{job=\"paypilot-api\",route=~\"$route\"}[$__rate_interval]))",
          "legendFormat": "{{status}}"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "reqps",
          "custom": {
            "drawStyle": "line",
            "lineInterpolation": "linear",
            "fillOpacity": 10,
            "showPoints": "never"
          }
        },
        "overrides": []
      },
      "options": {
        "legend": { "displayMode": "list", "placement": "bottom", "showLegend": true },
        "tooltip": { "mode": "multi", "sort": "none" }
      }
    },
    {
      "id": 6,
      "type": "timeseries",
      "title": "5xx ratio",
      "datasource": { "type": "prometheus", "uid": "paypilot-prometheus" },
      "gridPos": { "h": 8, "w": 12, "x": 12, "y": 4 },
      "targets": [
        {
          "refId": "A",
          "expr": "sum(rate(paypilot_http_requests_total{job=\"paypilot-api\",route=~\"$route\",status=~\"5..\"}[$__rate_interval])) / clamp_min(sum(rate(paypilot_http_requests_total{job=\"paypilot-api\",route=~\"$route\"}[$__rate_interval])), 1e-9)",
          "legendFormat": "5xx ratio"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "percentunit",
          "custom": {
            "drawStyle": "line",
            "lineInterpolation": "linear",
            "fillOpacity": 10,
            "showPoints": "never"
          }
        },
        "overrides": []
      },
      "options": {
        "legend": { "displayMode": "list", "placement": "bottom", "showLegend": true },
        "tooltip": { "mode": "multi", "sort": "none" }
      }
    },
    {
      "id": 7,
      "type": "timeseries",
      "title": "Latency p50 / p95 / p99",
      "datasource": { "type": "prometheus", "uid": "paypilot-prometheus" },
      "gridPos": { "h": 8, "w": 24, "x": 0, "y": 12 },
      "targets": [
        {
          "refId": "A",
          "expr": "histogram_quantile(0.50, sum by (le) (rate(paypilot_http_request_duration_seconds_bucket{job=\"paypilot-api\",route=~\"$route\"}[$__rate_interval])))",
          "legendFormat": "p50"
        },
        {
          "refId": "B",
          "expr": "histogram_quantile(0.95, sum by (le) (rate(paypilot_http_request_duration_seconds_bucket{job=\"paypilot-api\",route=~\"$route\"}[$__rate_interval])))",
          "legendFormat": "p95"
        },
        {
          "refId": "C",
          "expr": "histogram_quantile(0.99, sum by (le) (rate(paypilot_http_request_duration_seconds_bucket{job=\"paypilot-api\",route=~\"$route\"}[$__rate_interval])))",
          "legendFormat": "p99"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "s",
          "custom": {
            "drawStyle": "line",
            "lineInterpolation": "linear",
            "fillOpacity": 10,
            "showPoints": "never"
          }
        },
        "overrides": []
      },
      "options": {
        "legend": { "displayMode": "list", "placement": "bottom", "showLegend": true },
        "tooltip": { "mode": "multi", "sort": "none" }
      }
    },
    {
      "id": 8,
      "type": "timeseries",
      "title": "In-flight requests",
      "datasource": { "type": "prometheus", "uid": "paypilot-prometheus" },
      "gridPos": { "h": 8, "w": 8, "x": 0, "y": 20 },
      "targets": [
        {
          "refId": "A",
          "expr": "paypilot_http_requests_in_flight{job=\"paypilot-api\"}",
          "legendFormat": "in flight"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "short",
          "custom": {
            "drawStyle": "line",
            "lineInterpolation": "linear",
            "fillOpacity": 10,
            "showPoints": "never"
          }
        },
        "overrides": []
      },
      "options": {
        "legend": { "displayMode": "list", "placement": "bottom", "showLegend": true },
        "tooltip": { "mode": "multi", "sort": "none" }
      }
    },
    {
      "id": 9,
      "type": "timeseries",
      "title": "Process CPU",
      "datasource": { "type": "prometheus", "uid": "paypilot-prometheus" },
      "gridPos": { "h": 8, "w": 8, "x": 8, "y": 20 },
      "targets": [
        {
          "refId": "A",
          "expr": "rate(paypilot_process_cpu_seconds_total{job=\"paypilot-api\"}[$__rate_interval])",
          "legendFormat": "CPU"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "percentunit",
          "custom": {
            "drawStyle": "line",
            "lineInterpolation": "linear",
            "fillOpacity": 10,
            "showPoints": "never"
          }
        },
        "overrides": []
      },
      "options": {
        "legend": { "displayMode": "list", "placement": "bottom", "showLegend": true },
        "tooltip": { "mode": "multi", "sort": "none" }
      }
    },
    {
      "id": 10,
      "type": "timeseries",
      "title": "Process resident memory",
      "datasource": { "type": "prometheus", "uid": "paypilot-prometheus" },
      "gridPos": { "h": 8, "w": 8, "x": 16, "y": 20 },
      "targets": [
        {
          "refId": "A",
          "expr": "paypilot_process_resident_memory_bytes{job=\"paypilot-api\"}",
          "legendFormat": "RSS"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "bytes",
          "custom": {
            "drawStyle": "line",
            "lineInterpolation": "linear",
            "fillOpacity": 10,
            "showPoints": "never"
          }
        },
        "overrides": []
      },
      "options": {
        "legend": { "displayMode": "list", "placement": "bottom", "showLegend": true },
        "tooltip": { "mode": "multi", "sort": "none" }
      }
    },
    {
      "id": 11,
      "type": "timeseries",
      "title": "Event loop lag",
      "datasource": { "type": "prometheus", "uid": "paypilot-prometheus" },
      "gridPos": { "h": 8, "w": 12, "x": 0, "y": 28 },
      "targets": [
        {
          "refId": "A",
          "expr": "paypilot_nodejs_eventloop_lag_seconds{job=\"paypilot-api\"}",
          "legendFormat": "lag"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "s",
          "custom": {
            "drawStyle": "line",
            "lineInterpolation": "linear",
            "fillOpacity": 10,
            "showPoints": "never"
          }
        },
        "overrides": []
      },
      "options": {
        "legend": { "displayMode": "list", "placement": "bottom", "showLegend": true },
        "tooltip": { "mode": "multi", "sort": "none" }
      }
    },
    {
      "id": 12,
      "type": "timeseries",
      "title": "Active handles",
      "datasource": { "type": "prometheus", "uid": "paypilot-prometheus" },
      "gridPos": { "h": 8, "w": 12, "x": 12, "y": 28 },
      "targets": [
        {
          "refId": "A",
          "expr": "paypilot_nodejs_active_handles_total{job=\"paypilot-api\"}",
          "legendFormat": "{{type}}"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "short",
          "custom": {
            "drawStyle": "line",
            "lineInterpolation": "linear",
            "fillOpacity": 10,
            "showPoints": "never"
          }
        },
        "overrides": []
      },
      "options": {
        "legend": { "displayMode": "list", "placement": "bottom", "showLegend": true },
        "tooltip": { "mode": "multi", "sort": "none" }
      }
    },
    {
      "id": 13,
      "type": "timeseries",
      "title": "DB probe duration",
      "datasource": { "type": "prometheus", "uid": "paypilot-prometheus" },
      "gridPos": { "h": 8, "w": 12, "x": 0, "y": 36 },
      "targets": [
        {
          "refId": "A",
          "expr": "paypilot_db_probe_duration_seconds{job=\"paypilot-api\"}",
          "legendFormat": "duration"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "s",
          "custom": {
            "drawStyle": "line",
            "lineInterpolation": "linear",
            "fillOpacity": 10,
            "showPoints": "never"
          }
        },
        "overrides": []
      },
      "options": {
        "legend": { "displayMode": "list", "placement": "bottom", "showLegend": true },
        "tooltip": { "mode": "multi", "sort": "none" }
      }
    },
    {
      "id": 14,
      "type": "timeseries",
      "title": "DB probe age",
      "datasource": { "type": "prometheus", "uid": "paypilot-prometheus" },
      "gridPos": { "h": 8, "w": 12, "x": 12, "y": 36 },
      "targets": [
        {
          "refId": "A",
          "expr": "time() - paypilot_db_last_probe_timestamp_seconds{job=\"paypilot-api\"}",
          "legendFormat": "seconds since probe"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "s",
          "custom": {
            "drawStyle": "line",
            "lineInterpolation": "linear",
            "fillOpacity": 10,
            "showPoints": "never"
          }
        },
        "overrides": []
      },
      "options": {
        "legend": { "displayMode": "list", "placement": "bottom", "showLegend": true },
        "tooltip": { "mode": "multi", "sort": "none" }
      }
    },
    {
      "id": 15,
      "type": "table",
      "title": "Top routes",
      "datasource": { "type": "prometheus", "uid": "paypilot-prometheus" },
      "gridPos": { "h": 8, "w": 24, "x": 0, "y": 44 },
      "targets": [
        {
          "refId": "A",
          "expr": "topk(10, sum by (route) (rate(paypilot_http_requests_total{job=\"paypilot-api\"}[$__rate_interval])))",
          "format": "table",
          "instant": true
        }
      ],
      "fieldConfig": {
        "defaults": { "custom": { "align": "auto", "filterable": true } },
        "overrides": []
      },
      "options": { "showHeader": true }
    }
  ]
}
```

### 11.5 Create the Business Activity dashboard

Create `docker/grafana/dashboards/business-activity.json`:

```json
{
  "id": null,
  "uid": "paypilot-business-activity",
  "title": "PayPilot Business Activity",
  "tags": ["paypilot", "business"],
  "timezone": "browser",
  "schemaVersion": 39,
  "version": 1,
  "refresh": "30s",
  "time": { "from": "now-7d", "to": "now" },
  "annotations": { "list": [] },
  "templating": { "list": [] },
  "panels": [
    {
      "id": 1,
      "type": "stat",
      "title": "Punches in (24h)",
      "datasource": { "type": "prometheus", "uid": "paypilot-prometheus" },
      "gridPos": { "h": 4, "w": 5, "x": 0, "y": 0 },
      "targets": [
        {
          "refId": "A",
          "expr": "sum(increase(paypilot_attendance_punches_total{job=\"paypilot-api\",action=\"in\"}[24h])) or vector(0)",
          "instant": true
        }
      ],
      "fieldConfig": { "defaults": { "unit": "short" }, "overrides": [] },
      "options": {
        "reduceOptions": { "calcs": ["lastNotNull"], "fields": "", "values": false },
        "colorMode": "value",
        "graphMode": "area",
        "justifyMode": "auto",
        "orientation": "auto",
        "textMode": "auto"
      }
    },
    {
      "id": 2,
      "type": "stat",
      "title": "Punches out (24h)",
      "datasource": { "type": "prometheus", "uid": "paypilot-prometheus" },
      "gridPos": { "h": 4, "w": 5, "x": 5, "y": 0 },
      "targets": [
        {
          "refId": "A",
          "expr": "sum(increase(paypilot_attendance_punches_total{job=\"paypilot-api\",action=\"out\"}[24h])) or vector(0)",
          "instant": true
        }
      ],
      "fieldConfig": { "defaults": { "unit": "short" }, "overrides": [] },
      "options": {
        "reduceOptions": { "calcs": ["lastNotNull"], "fields": "", "values": false },
        "colorMode": "value",
        "graphMode": "area",
        "justifyMode": "auto",
        "orientation": "auto",
        "textMode": "auto"
      }
    },
    {
      "id": 3,
      "type": "stat",
      "title": "Leave requests created (24h)",
      "datasource": { "type": "prometheus", "uid": "paypilot-prometheus" },
      "gridPos": { "h": 4, "w": 5, "x": 10, "y": 0 },
      "targets": [
        {
          "refId": "A",
          "expr": "sum(increase(paypilot_leave_requests_created_total{job=\"paypilot-api\"}[24h])) or vector(0)",
          "instant": true
        }
      ],
      "fieldConfig": { "defaults": { "unit": "short" }, "overrides": [] },
      "options": {
        "reduceOptions": { "calcs": ["lastNotNull"], "fields": "", "values": false },
        "colorMode": "value",
        "graphMode": "area",
        "justifyMode": "auto",
        "orientation": "auto",
        "textMode": "auto"
      }
    },
    {
      "id": 4,
      "type": "stat",
      "title": "Leave reviews (24h)",
      "datasource": { "type": "prometheus", "uid": "paypilot-prometheus" },
      "gridPos": { "h": 4, "w": 5, "x": 15, "y": 0 },
      "targets": [
        {
          "refId": "A",
          "expr": "sum(increase(paypilot_leave_reviews_total{job=\"paypilot-api\"}[24h])) or vector(0)",
          "instant": true
        }
      ],
      "fieldConfig": { "defaults": { "unit": "short" }, "overrides": [] },
      "options": {
        "reduceOptions": { "calcs": ["lastNotNull"], "fields": "", "values": false },
        "colorMode": "value",
        "graphMode": "area",
        "justifyMode": "auto",
        "orientation": "auto",
        "textMode": "auto"
      }
    },
    {
      "id": 5,
      "type": "stat",
      "title": "Payroll imports (24h)",
      "datasource": { "type": "prometheus", "uid": "paypilot-prometheus" },
      "gridPos": { "h": 4, "w": 4, "x": 20, "y": 0 },
      "targets": [
        {
          "refId": "A",
          "expr": "sum(increase(paypilot_payroll_imports_total{job=\"paypilot-api\"}[24h])) or vector(0)",
          "instant": true
        }
      ],
      "fieldConfig": { "defaults": { "unit": "short" }, "overrides": [] },
      "options": {
        "reduceOptions": { "calcs": ["lastNotNull"], "fields": "", "values": false },
        "colorMode": "value",
        "graphMode": "area",
        "justifyMode": "auto",
        "orientation": "auto",
        "textMode": "auto"
      }
    },
    {
      "id": 6,
      "type": "timeseries",
      "title": "Punch rate by action",
      "datasource": { "type": "prometheus", "uid": "paypilot-prometheus" },
      "gridPos": { "h": 8, "w": 12, "x": 0, "y": 4 },
      "targets": [
        {
          "refId": "A",
          "expr": "sum by (action) (rate(paypilot_attendance_punches_total{job=\"paypilot-api\"}[$__rate_interval]))",
          "legendFormat": "{{action}}"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "short",
          "custom": {
            "drawStyle": "line",
            "lineInterpolation": "linear",
            "fillOpacity": 10,
            "showPoints": "never"
          }
        },
        "overrides": []
      },
      "options": {
        "legend": { "displayMode": "list", "placement": "bottom", "showLegend": true },
        "tooltip": { "mode": "multi", "sort": "none" }
      }
    },
    {
      "id": 7,
      "type": "timeseries",
      "title": "Leave requests by type",
      "datasource": { "type": "prometheus", "uid": "paypilot-prometheus" },
      "gridPos": { "h": 8, "w": 12, "x": 12, "y": 4 },
      "targets": [
        {
          "refId": "A",
          "expr": "sum by (leave_type) (increase(paypilot_leave_requests_created_total{job=\"paypilot-api\"}[$__range]))",
          "legendFormat": "{{leave_type}}"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "short",
          "custom": {
            "drawStyle": "bars",
            "lineInterpolation": "linear",
            "fillOpacity": 60,
            "showPoints": "never"
          }
        },
        "overrides": []
      },
      "options": {
        "legend": { "displayMode": "list", "placement": "bottom", "showLegend": true },
        "tooltip": { "mode": "multi", "sort": "none" }
      }
    },
    {
      "id": 8,
      "type": "timeseries",
      "title": "Leave reviews by decision",
      "datasource": { "type": "prometheus", "uid": "paypilot-prometheus" },
      "gridPos": { "h": 8, "w": 12, "x": 0, "y": 12 },
      "targets": [
        {
          "refId": "A",
          "expr": "sum by (decision) (increase(paypilot_leave_reviews_total{job=\"paypilot-api\"}[$__range]))",
          "legendFormat": "{{decision}}"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "short",
          "custom": {
            "drawStyle": "bars",
            "lineInterpolation": "linear",
            "fillOpacity": 60,
            "showPoints": "never"
          }
        },
        "overrides": []
      },
      "options": {
        "legend": { "displayMode": "list", "placement": "bottom", "showLegend": true },
        "tooltip": { "mode": "multi", "sort": "none" }
      }
    },
    {
      "id": 9,
      "type": "timeseries",
      "title": "Payroll imports by status",
      "datasource": { "type": "prometheus", "uid": "paypilot-prometheus" },
      "gridPos": { "h": 8, "w": 12, "x": 12, "y": 12 },
      "targets": [
        {
          "refId": "A",
          "expr": "sum by (status) (increase(paypilot_payroll_imports_total{job=\"paypilot-api\"}[$__range]))",
          "legendFormat": "{{status}}"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "short",
          "custom": {
            "drawStyle": "bars",
            "lineInterpolation": "linear",
            "fillOpacity": 60,
            "showPoints": "never"
          }
        },
        "overrides": []
      },
      "options": {
        "legend": { "displayMode": "list", "placement": "bottom", "showLegend": true },
        "tooltip": { "mode": "multi", "sort": "none" }
      }
    },
    {
      "id": 10,
      "type": "table",
      "title": "Attendance punch totals",
      "datasource": { "type": "prometheus", "uid": "paypilot-prometheus" },
      "gridPos": { "h": 8, "w": 8, "x": 0, "y": 20 },
      "targets": [
        {
          "refId": "A",
          "expr": "sum by (action) (increase(paypilot_attendance_punches_total{job=\"paypilot-api\"}[$__range]))",
          "format": "table",
          "instant": true
        }
      ],
      "fieldConfig": {
        "defaults": { "custom": { "align": "auto", "filterable": true } },
        "overrides": []
      },
      "options": { "showHeader": true }
    },
    {
      "id": 11,
      "type": "table",
      "title": "Leave request totals",
      "datasource": { "type": "prometheus", "uid": "paypilot-prometheus" },
      "gridPos": { "h": 8, "w": 8, "x": 8, "y": 20 },
      "targets": [
        {
          "refId": "A",
          "expr": "sum by (leave_type) (increase(paypilot_leave_requests_created_total{job=\"paypilot-api\"}[$__range]))",
          "format": "table",
          "instant": true
        }
      ],
      "fieldConfig": {
        "defaults": { "custom": { "align": "auto", "filterable": true } },
        "overrides": []
      },
      "options": { "showHeader": true }
    },
    {
      "id": 12,
      "type": "table",
      "title": "Payroll import totals",
      "datasource": { "type": "prometheus", "uid": "paypilot-prometheus" },
      "gridPos": { "h": 8, "w": 8, "x": 16, "y": 20 },
      "targets": [
        {
          "refId": "A",
          "expr": "sum by (status) (increase(paypilot_payroll_imports_total{job=\"paypilot-api\"}[$__range]))",
          "format": "table",
          "instant": true
        }
      ],
      "fieldConfig": {
        "defaults": { "custom": { "align": "auto", "filterable": true } },
        "overrides": []
      },
      "options": { "showHeader": true }
    }
  ]
}
```

### 11.6 Validate Grafana

Add a Grafana admin password to the local (ignored) `.env` if it is missing:

```bash
grep -q '^GRAFANA_ADMIN_PASSWORD=' .env || \
  printf '\nGRAFANA_ADMIN_PASSWORD=%s\n' "$(openssl rand -hex 16)" >> .env
```

Start the stack and verify:

```bash
docker-compose config >/dev/null
docker-compose up -d prometheus grafana
until [ "$(docker inspect -f '{{.State.Health.Status}}' paypilot-grafana)" = "healthy" ]; do sleep 1; done
docker-compose ps
curl -fsS http://localhost:3000/api/health
```

Then check:

1. `http://localhost:3000` redirects to the login page (anonymous access is disabled).
2. Log in with the `.env` credentials.
3. The **PayPilot** folder contains **PayPilot API Overview** and **PayPilot Business Activity**.
4. The datasource **Prometheus** is healthy (`Connections → Data sources → Prometheus → Save & test`).
5. Both dashboards render without a datasource error.

Confirm the dashboards are valid JSON before committing:

```bash
node -e "for (const f of ['docker/grafana/dashboards/api-overview.json','docker/grafana/dashboards/business-activity.json']) { JSON.parse(require('fs').readFileSync(f,'utf8')); console.log(f, 'ok'); }"
```

Commit:

```bash
git add docker-compose.yml docker/grafana
git commit -m "feat(infra): provision Grafana dashboards for API and business metrics"
```

> **Execution note (`8953c0f`, `0c72872`):** Review hardened the Grafana setup beyond the plan. `.env.example` gained the full Observability block (`HOST`, `METRICS_TOKEN_FILE`, `HOST_GID`, `PROMETHEUS_PORT`, `GRAFANA_PORT`, `GRAFANA_ADMIN_USER`, `GRAFANA_ADMIN_PASSWORD`, token `0640` instructions) so the stack starts from a clean checkout. The datasource drops the legacy `access: proxy` and declares `prometheusType: Prometheus`; Grafana disables plugin pre-install and analytics reporting. Both dashboards are `editable: false` and cross-link to each other. API Overview uses `clamp_min` on the 5xx denominator plus `or vector(0)` (so idle windows show 0 instead of a NaN gap), scopes the `route` variable to `job="paypilot-api"`, plots CPU as `short`/cores, and uses `paypilot_nodejs_eventloop_lag_p99_seconds`. Business Activity timeseries use `increase(...[$__interval])` with `interval: "15s"` so short zooms never blank, stat panels use `graphMode: "none"`, and tables declare units/decimals. Empty `provisioning/plugins` and `provisioning/alerting` directories silence Grafana's startup provisioning errors.

---

## Task 12: Document the setup and ignore local secrets

**Files:** `.gitignore`, `.env.example`, `README.md`, `docs/OBSERVABILITY.md`

### 12.1 Ignore `.secrets/`

Add to `.gitignore` under the environment/credentials section:

```gitignore
# Local secrets (metrics bearer token)
.secrets/
```

### 12.2 Update `.env.example`

Add the API variables after `CORS_ORIGIN`:

```dotenv
# Interface the API listens on. 0.0.0.0 is required for Prometheus running in
# Docker to reach the host API through host.docker.internal. Restrict port 4000
# with a host firewall; see README section "Observability".
HOST=0.0.0.0

# File containing the bearer token required by GET /metrics. Relative paths
# resolve from the repository root. Generate it with:
#   mkdir -p .secrets && chmod 700 .secrets
#   printf '%s' "$(openssl rand -hex 32)" > .secrets/paypilot_metrics_token
#   chmod 640 .secrets/paypilot_metrics_token
METRICS_TOKEN_FILE=./.secrets/paypilot_metrics_token
```

Add the Compose-only variables at the end of the Docker Compose section:

```dotenv
# Prometheus and Grafana publish on 127.0.0.1 only.
PROMETHEUS_PORT=9090
GRAFANA_PORT=3000
GRAFANA_ADMIN_USER=admin
# Required by docker-compose. Generate a unique value; never commit it.
GRAFANA_ADMIN_PASSWORD=change-me-grafana-admin
```

### 12.3 Add the README section

Insert a new section before `## 10. API Endpoints` and renumber the existing headings:

- `## 10. API Endpoints` → `## 11. API Endpoints`
- `## 11. Next Implementation Milestones` → `## 12. Next Implementation Milestones`

The new section:

````markdown
## 10. Observability

Prometheus and Grafana run in the local Docker Compose stack. The API runs on the host and exposes a token-protected `GET /metrics` endpoint.

```text
Host API (HOST=0.0.0.0, PORT=4000)
  GET /metrics  ->  Bearer token required
        ^
        | host.docker.internal:4000
Prometheus (127.0.0.1:9090) -> 15s scrape, 15d retention
Grafana    (127.0.0.1:3000) -> provisioned datasource + two dashboards
```

### 10.1 Generate the metrics token

```bash
mkdir -p .secrets
chmod 700 .secrets
printf '%s' "$(openssl rand -hex 32)" > .secrets/paypilot_metrics_token
chmod 640 .secrets/paypilot_metrics_token
```

`.secrets/` is git-ignored. The API reads the token from `METRICS_TOKEN_FILE`; Prometheus reads the same file through a Compose secret at `/run/secrets/paypilot_metrics_token`. Rotating the token requires restarting the API; Prometheus picks up the new file on its next scrape.

### 10.2 Start the stack

Add `GRAFANA_ADMIN_PASSWORD` to `.env` if it is missing, then:

```bash
docker-compose up -d prometheus grafana
```

- Prometheus: <http://localhost:9090> (targets at `/targets`, alerts at `/alerts`)
- Grafana: <http://localhost:3000> (login with `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD`)

Both ports bind to `127.0.0.1`. Grafana anonymous access and sign-up are disabled.

### 10.3 Verify `/metrics`

```bash
curl -i http://localhost:4000/metrics
# HTTP/1.1 401 Unauthorized
# WWW-Authenticate: Bearer

curl -s -H "Authorization: Bearer $(cat .secrets/paypilot_metrics_token)" \
  http://localhost:4000/metrics | head
# HTTP/1.1 200 OK
```

`/metrics` is not proxied by Vite and never emits CORS headers.

### 10.4 Firewall requirement

Because `host.docker.internal` cannot reach a loopback-only listener, the API binds `0.0.0.0`. Restrict port 4000 to loopback and the Docker bridge subnet:

```bash
sudo iptables -N PAYPILOT_API 2>/dev/null || true
sudo iptables -F PAYPILOT_API
sudo iptables -A PAYPILOT_API -s 127.0.0.0/8 -j ACCEPT
sudo iptables -A PAYPILOT_API -s 172.16.0.0/12 -j ACCEPT
sudo iptables -A PAYPILOT_API -j DROP
sudo iptables -I INPUT -p tcp --dport 4000 -j PAYPILOT_API
```

Adapt `172.16.0.0/12` to the actual bridge subnet from:

```bash
docker network inspect bridge --format '{{(index .IPAM.Config 0).Subnet}}'
```

### 10.5 Dashboards and alerts

Grafana provisions two dashboards from JSON in the **PayPilot** folder:

- **PayPilot API Overview** — target/DB health, request rate, 5xx ratio, latency, in-flight requests, process CPU/memory, event loop, DB probe, top routes.
- **PayPilot Business Activity** — attendance punches, leave requests and reviews, payroll imports.

Prometheus provisions five alerts: `PayPilotApiDown`, `PayPilotHigh5xxRate`, `PayPilotHighP95Latency`, `PayPilotDatabaseDown`, and `PayPilotDatabaseProbeStale`. There is no Alertmanager; firing alerts appear in the Prometheus UI and can be added to a Grafana panel.

Dashboard JSON is the source of truth. UI edits are overwritten on restart. Export changes back to JSON. Changing histogram buckets requires updating dashboard and alert queries in the same change.

See [docs/OBSERVABILITY.md](./docs/OBSERVABILITY.md) for the metric catalog, label policy, alert thresholds, and troubleshooting.
````

Add these rows to the section 6 environment table:

```markdown
| `HOST` | API listen interface; `0.0.0.0` is required for Docker-hosted Prometheus |
| `METRICS_TOKEN_FILE` | Path to the `/metrics` bearer token; relative paths resolve from the repo root |
| `PROMETHEUS_PORT`, `GRAFANA_PORT` | Localhost-bound Prometheus and Grafana ports |
| `GRAFANA_ADMIN_USER`, `GRAFANA_ADMIN_PASSWORD` | Grafana admin login |
```

### 12.4 Create `docs/OBSERVABILITY.md`

````markdown
# Observability Runbook

**Scope:** Metrics-only observability for the PayPilot API, Prometheus, and Grafana in local Docker Compose.

---

## 1. Architecture

```text
Host API (HOST=0.0.0.0, PORT=4000)
  GET /metrics  ->  Bearer token required
        ^
        | host.docker.internal:4000
Prometheus (127.0.0.1:9090) -> 15s scrape, 15d retention
Grafana    (127.0.0.1:3000) -> provisioned datasource + two dashboards
```

- The API runs on the host. Prometheus reaches it through `host.docker.internal` and the Docker bridge.
- Prometheus and Grafana run in Docker Compose and publish only on `127.0.0.1`.
- `/metrics` is mounted before CORS and is never proxied by the web app.
- There is no OpenTelemetry, tracing, log aggregation, Alertmanager, or Kubernetes.

---

## 2. Metric catalog

### HTTP metrics

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `paypilot_http_requests_total` | Counter | `method`, `route`, `status` | Completed requests |
| `paypilot_http_request_duration_seconds` | Histogram | `method`, `route`, `status` | Request duration |
| `paypilot_http_requests_in_flight` | Gauge | none | Requests currently being handled |

- `method` is one of `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`, or `OTHER`.
- `route` is an Express route pattern such as `/api/leave-requests/:id/review`, or `unmatched`.
- `status` is the final numeric status code.
- `/metrics` and `/api/health*` are excluded.
- Aborted requests decrement the in-flight gauge but do not increment the counter or histogram.
- Histogram buckets (`http_duration_buckets_v1`): `0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10` seconds.

### Business metrics

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `paypilot_attendance_punches_total` | Counter | `action` = `in`, `out` | Committed punches |
| `paypilot_leave_requests_created_total` | Counter | `leave_type` | Committed leave requests |
| `paypilot_leave_reviews_total` | Counter | `decision` = `approve`, `reject` | Committed reviews |
| `paypilot_payroll_imports_total` | Counter | `status` = `COMPLETED`, `FAILED` | Persisted import batches |

Business counters run from `res.on('finish')` and only for `2xx`/`3xx` responses after the tenant transaction commits. They are best-effort observability, not billing records. A crash or disconnect between commit and `finish` can miss a count.

### Database probe metrics

| Metric | Type | Meaning |
|---|---|---|
| `paypilot_db_up` | Gauge | `1` on success, `0` on failure or timeout |
| `paypilot_db_probe_duration_seconds` | Gauge | Most recent probe duration |
| `paypilot_db_last_probe_timestamp_seconds` | Gauge | Unix timestamp of the most recent completed attempt |

The probe runs every 15 seconds with a 2-second timeout, executes `SELECT 1`, and never overlaps itself. It runs once at startup.

### Default Node metrics

`collectDefaultMetrics` adds `paypilot_process_*` and `paypilot_nodejs_*` metrics. Dashboards use:

- `paypilot_process_cpu_seconds_total`
- `paypilot_process_resident_memory_bytes`
- `paypilot_process_start_time_seconds`
- `paypilot_nodejs_eventloop_lag_seconds`
- `paypilot_nodejs_active_handles_total`

---

## 3. Label and cardinality policy

- Never label with UUIDs, employee IDs, organization IDs, emails, filenames, dates, amounts, query strings, or raw URLs.
- `route` comes from Express route patterns only. Unmatched routes use `unmatched`.
- Business labels come from bounded Prisma enums or literal sets.
- Every bounded business label combination is initialized with `.inc(0)` so dashboards show zero instead of "no data" and new unbounded values are obvious in review.
- Do not add request/response body size, user agent, IP address, or request ID labels.
- Disk retention bounds time, not cardinality. The label policy is the primary protection.

---

## 4. Dashboard catalog

### PayPilot API Overview (`paypilot-api-overview`)

Default range: 6 hours. Refresh: 30 seconds.

- Stats: API target up, DB up, process uptime, in-flight requests.
- Request rate by status.
- 5xx ratio (numerator and denominator aggregated separately).
- Latency p50/p95/p99.
- In-flight requests.
- Process CPU and resident memory.
- Event loop lag and active handles.
- DB probe duration and probe age.
- Top 10 routes.
- `route` template variable with `All` default.

### PayPilot Business Activity (`paypilot-business-activity`)

Default range: 7 days. Refresh: 30 seconds.

- 24-hour stats: punches in/out, leave requests created, leave reviews, payroll imports.
- Punch rate by action.
- Leave requests by type.
- Leave reviews by decision.
- Payroll imports by status.
- Totals tables for punches, leave requests, and imports.

Dashboard JSON lives in `docker/grafana/dashboards/`. UI edits are overwritten on restart; export changes back to JSON.

---

## 5. Alert catalog

| Alert | Condition | Threshold | `for` | Severity |
|---|---|---|---|---|
| `PayPilotApiDown` | `up{job="paypilot-api"} == 0` | target unreachable | `2m` | critical |
| `PayPilotHigh5xxRate` | 5xx / all requests | `> 5%` with at least 50 requests in 5m | `10m` | warning |
| `PayPilotHighP95Latency` | histogram p95 | `> 1s` with at least 50 requests in 5m | `10m` | warning |
| `PayPilotDatabaseDown` | `paypilot_db_up == 0` and fresh probe | failure for 2m | `2m` | critical |
| `PayPilotDatabaseProbeStale` | `time() - last_probe_timestamp > 60` | probe older than 60s | `5m` | warning |

- The 5xx ratio aggregates the numerator and denominator separately, then divides.
- Minimum traffic and sample thresholds prevent low-traffic noise and single-request spikes.
- `PayPilotDatabaseDown` requires a fresh probe, so a dead API triggers `PayPilotApiDown` instead of a stale DB alert.
- `PayPilotDatabaseProbeStale` covers an API that is up but whose probe loop stopped.
- No Alertmanager is configured; alerts are visible in Prometheus (`/alerts`) and Grafana.

Validate the rules with the pinned image:

```bash
docker-compose exec prometheus /bin/promtool check config /etc/prometheus/prometheus.yml
docker-compose exec prometheus /bin/promtool check rules /etc/prometheus/alerts.yml
docker-compose exec prometheus /bin/promtool test rules /etc/prometheus/tests/alerts.test.yml
```

---

## 6. Token rotation

1. Generate a new token:

```bash
printf '%s' "$(openssl rand -hex 32)" > .secrets/paypilot_metrics_token
chmod 640 .secrets/paypilot_metrics_token
```

2. Restart the API so it reloads the file.
3. Prometheus reads `credentials_file` on its next scrape; no Prometheus restart is required.
4. Confirm `up{job="paypilot-api"} == 1`.

Never put the token in `.env`, `docker-compose.yml`, dashboard JSON, logs, or a commit.

---

## 7. Troubleshooting

### Prometheus target is down

- Confirm the API is listening on `0.0.0.0:4000` and `HOST` is not `127.0.0.1`.
- From the Prometheus container: `docker-compose exec prometheus wget -qO- http://host.docker.internal:4000/metrics` should return `401` without a token, which proves reachability.
- Confirm `extra_hosts: ["host.docker.internal:host-gateway"]` is present.
- Check host firewall rules for port 4000.

### Prometheus gets `401`

- Confirm `/run/secrets/paypilot_metrics_token` exists inside the container.
- Confirm `.secrets/paypilot_metrics_token` exists on the host and is readable by the Compose secret mount.
- Confirm the API was restarted after the token changed.
- Do not add the token to the scrape URL or logs.

### Grafana has no data

- Open `Connections → Data sources → Prometheus → Save & test`.
- Confirm the datasource URL is `http://prometheus:9090` (service DNS, not localhost).
- Confirm the Prometheus target is `UP`.
- Confirm the dashboard uses UID `paypilot-prometheus`.

### Business panels stay at zero

- Generate real traffic through the API (punch, leave request, review, payroll import).
- Business counters only increment on `2xx`/`3xx` responses after commit.
- Confirm the route hook is registered after the service call.

### Histogram or latency results look wrong

- Histogram buckets are versioned as `http_duration_buckets_v1`.
- Changing buckets requires updating dashboard queries, alert queries, and `docker/prometheus/tests/alerts.test.yml` together.

---

## 8. Security limitations

- Local development only; no TLS.
- Static bearer token; rotation requires an API restart.
- No Alertmanager or notification delivery.
- Prometheus has no authentication and is localhost-only. Do not expose it publicly.
- Grafana anonymous access and sign-up are disabled; the admin password lives in `.env`.
- The token is protected by host file permissions and Compose secret mounting, not encryption at rest.

---

## 9. Adding a metric

1. Define it in `apps/api/src/lib/metrics.ts` against the shared registry.
2. Use bounded labels only.
3. Initialize zero values for every bounded label combination.
4. Add unit tests for definitions and behavior.
5. Add integration coverage when the metric depends on a route.
6. Update the dashboard JSON and, if alertable, `docker/prometheus/alerts.yml` plus its rule tests.
7. Run `promtool check config`, `promtool check rules`, and `promtool test rules`.
````

### 12.5 Verify the docs

```bash
node -e "const fs=require('fs'); for (const f of ['README.md','docs/OBSERVABILITY.md','.env.example','.gitignore']) { if (!fs.existsSync(f)) throw new Error(f); } console.log('docs present')"
git diff --stat
```

Confirm `.secrets/` is ignored:

```bash
git check-ignore -v .secrets/paypilot_metrics_token
```

Commit:

```bash
git add .gitignore .env.example README.md docs/OBSERVABILITY.md
git commit -m "docs: document observability setup, metrics, dashboards, and alerts"
```

---

## Task 13: Full verification and pull request

**Files:** none (verification only)

### 13.1 Run the complete local suite

```bash
npm run prisma:validate
npm run typecheck
npm run typecheck:tests --workspace=apps/api
npm run build
npm test
RUN_DB_INTEGRATION=1 npm run test:integration --workspace=apps/api
```

Every command must exit `0`. The integration suite requires PostgreSQL and `DIRECT_URL`.

### 13.2 Validate the observability stack

```bash
docker-compose config >/dev/null
docker-compose up -d prometheus grafana
until [ "$(docker inspect -f '{{.State.Health.Status}}' paypilot-prometheus)" = "healthy" ]; do sleep 1; done
until [ "$(docker inspect -f '{{.State.Health.Status}}' paypilot-grafana)" = "healthy" ]; do sleep 1; done
docker-compose ps
docker-compose exec prometheus /bin/promtool check config /etc/prometheus/prometheus.yml
docker-compose exec prometheus /bin/promtool check rules /etc/prometheus/alerts.yml
docker-compose exec prometheus /bin/promtool test rules /etc/prometheus/tests/alerts.test.yml
```

Expected: `SUCCESS` for all three `promtool` commands and both containers healthy.

### 13.3 Manual acceptance checks

Run the API (`npm run dev --workspace=apps/api`) and check:

```bash
# 401 without a token
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4000/metrics

# 401 with a wrong token
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'Authorization: Bearer wrong' http://localhost:4000/metrics

# 200 with the correct token
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $(cat .secrets/paypilot_metrics_token)" \
  http://localhost:4000/metrics

# No CORS header on /metrics
curl -s -D - -o /dev/null \
  -H 'Origin: http://localhost:5173' \
  -H "Authorization: Bearer $(cat .secrets/paypilot_metrics_token)" \
  http://localhost:4000/metrics | grep -i 'access-control-allow-origin' || echo 'no CORS header'

# Prometheus target and alerts
curl -s http://localhost:9090/api/v1/targets | grep -o '"health":"[a-z]*"' | head
curl -s http://localhost:9090/api/v1/rules | grep -o '"name":"PayPilot[A-Za-z0-9]*"'

# Grafana health and login page
curl -fsS http://localhost:3000/api/health
```

In the browser:

1. `http://localhost:9090/targets` shows `paypilot-api` `UP`.
2. `http://localhost:9090/alerts` lists the five rules.
3. `http://localhost:3000` redirects to login; anonymous access is denied.
4. Both provisioned dashboards render data.
5. Trigger a punch and a leave request, then confirm the business panels move.
6. Stop the API and confirm `PayPilotApiDown` fires after 2 minutes; restart it and confirm it resolves.

### 13.4 Final review

```bash
git status --short
git log --oneline main..HEAD
git diff --stat main...HEAD
```

Confirm:

- The only changed files are the observability files listed in the file map.
- The three unrelated web files are still unstaged and unmodified by this work.
- No token, `.env`, `.secrets/`, or generated artifact is staged.
- The spec status reads `Approved 2026-11-09`.

### 13.5 Push and open the pull request

```bash
git push -u origin feat/observability

gh pr create \
  --base main \
  --head feat/observability \
  --title "feat: add metrics observability with Prometheus and Grafana" \
  --body "## Summary
- Add a token-protected GET /metrics endpoint using @prometheus-io/client.
- Instrument HTTP, attendance, leave, payroll imports, and DB probe health.
- Provision Prometheus (15s scrape, 15d retention, five alerts) and Grafana (two dashboards) in Docker Compose.
- Document setup, security, metric catalog, dashboards, and alerts.

## Verification
- npm run typecheck
- npm run typecheck:tests --workspace=apps/api
- npm run build
- npm test
- RUN_DB_INTEGRATION=1 npm run test:integration --workspace=apps/api
- promtool check config / check rules / test rules
- Manual /metrics 401/200 and Grafana dashboard checks

## Notes
- No schema or migration changes.
- No Alertmanager, OpenTelemetry, Loki, Tempo, Redis, or Kubernetes.
- /metrics and /api/health* are excluded from HTTP metrics.
- The API binds HOST=0.0.0.0; restrict port 4000 with a host firewall."
```

Do not merge until review passes.

---

## Completion checklist

- [ ] `@prometheus-io/client@0.16.1` installed; `prom-client` absent.
- [ ] `/metrics` returns `401` without a valid token and `200` with it.
- [ ] `/metrics` never emits CORS headers.
- [ ] HTTP metrics exclude `/metrics` and `/api/health*`.
- [ ] Unknown methods become `OTHER`; unmatched routes become `unmatched`.
- [ ] No UUIDs, IDs, emails, query strings, or raw URLs appear in labels.
- [ ] In-flight gauge is decremented exactly once, including aborted requests.
- [ ] Business counters only increment for committed `2xx`/`3xx` responses.
- [ ] DB probe runs every 15s, times out at 2s, never overlaps, and runs at startup.
- [ ] Prometheus scrapes the host API and retains 15 days.
- [ ] Five alert rules load and `promtool test rules` passes.
- [ ] Grafana provisions the Prometheus datasource and both dashboards.
- [ ] Grafana anonymous access and sign-up are disabled.
- [ ] `.secrets/` is ignored and no token is committed.
- [ ] README and `docs/OBSERVABILITY.md` are complete.
- [ ] Full typecheck, build, unit, and integration suites pass.
- [ ] PR opened against `main`; unrelated web changes excluded.






