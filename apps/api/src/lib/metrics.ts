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

export function normalizeMethod(method: string | undefined): string {
  if (!method) return 'OTHER';
  const upper = method.toUpperCase();
  return KNOWN_METHODS.has(upper) ? upper : 'OTHER';
}

const DYNAMIC_SEGMENT_PATTERNS = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^\d+$/,
  /^[0-9a-f]{16,}$/i,
];

// Best-effort: UUID, numeric, 16+ hex, and email-like mount segments become
// :param. Slug mounts are not detected, so keep router mounts static or add a
// dedicated captured base if a slug mount is introduced.
function sanitizeMountSegment(segment: string): string {
  if (segment.includes('@')) return ':param';
  if (DYNAMIC_SEGMENT_PATTERNS.some((pattern) => pattern.test(segment))) {
    return ':param';
  }
  return segment;
}

// Reconstruct the label from the request path and the matched route pattern
// rather than req.baseUrl: Express resets baseUrl to '' while an error unwinds
// to the app-level error handler. This assumes each pattern segment consumes
// exactly one path segment; optional params and wildcards would need a captured
// baseUrl instead.
export function normalizeRoute(req: Request): string {
  const routePath: unknown = req.route?.path;
  if (typeof routePath !== 'string') {
    return 'unmatched';
  }

  const patternSegments = routePath.split('/').filter(Boolean);
  const requestSegments = (req.originalUrl ?? req.url ?? '')
    .split('?')[0]
    .split('/')
    .filter(Boolean);

  const mountSegmentCount = Math.max(
    0,
    requestSegments.length - patternSegments.length
  );
  const mountSegments = requestSegments
    .slice(0, mountSegmentCount)
    .map(sanitizeMountSegment);

  const segments = [...mountSegments, ...patternSegments];
  return segments.length > 0 ? `/${segments.join('/')}` : '/';
}

export function isMetricsExcludedPath(pathName: string): boolean {
  const normalized = pathName.toLowerCase();
  return (
    normalized === '/metrics' ||
    normalized === '/api/health' ||
    normalized.startsWith('/api/health/')
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

  res.once('finish', () => {
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

// Pre-create the bounded business series so dashboards show zero instead of a
// gap before the first event. inc(0) is idempotent, so the server bootstrap may
// call this again safely.
initializeBusinessMetricSeries();
