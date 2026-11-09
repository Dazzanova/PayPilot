# PayPilot Observability Design — Metrics, Prometheus, Grafana

**Status:** Approved 2026-11-09
**Branch:** `feat/observability` (from `main`)
**Scope:** Metrics-only observability for the host-run API, plus Prometheus and Grafana in the existing local Docker Compose stack.

---

## 1. Goals

- Expose a Prometheus-compatible `GET /metrics` endpoint from the PayPilot API.
- Instrument HTTP traffic, Node runtime health, database probe health, and the implemented business flows: attendance punches, leave creation/review, and payroll imports.
- Scrape the API with Prometheus running in Docker Compose, retaining 15 days of metrics in a named volume.
- Provision two Grafana dashboards from JSON: **API Overview** and **Business Activity**.
- Provision core Prometheus alert rules and validate them with `promtool`.
- Keep labels bounded and safe: no UUIDs, employee/organization IDs, emails, query strings, raw URLs, or other unbounded values.
- Make the local setup secure by default: `/metrics` always requires a bearer token; Grafana anonymous access is disabled; Prometheus and Grafana bind to `127.0.0.1` only.

**Out of scope:** OpenTelemetry, tracing, log aggregation (Loki), Tempo, Alertmanager, notification delivery, Redis, Kubernetes, production TLS, Postgres/Keycloak exporters, and any schema or migration change.

---

## 2. Decisions

- Use `@prometheus-io/client@0.16.1`, the maintained successor to `prom-client`. The deprecated `prom-client@15.1.3` is not added. Local Node is v24.21.0, which satisfies the package's `^22 || ^24 || >=26` engine range.
- The API stays on the host. Prometheus reaches it through `host.docker.internal:4000`; Linux Compose gets `extra_hosts: ["host.docker.internal:host-gateway"]`.
- The API must listen on an interface reachable from the Docker bridge. Binding only to `127.0.0.1` is not sufficient because `host-gateway` does not make a loopback-only listener reachable. The API binds to `HOST=0.0.0.0` by default, and host firewall rules restrict port 4000 to the Docker bridge subnet.
- `/metrics` always requires a dedicated bearer token. There is no unauthenticated mode.
- The API reads the token from a file, `METRICS_TOKEN_FILE`, default `./.secrets/paypilot_metrics_token`. Prometheus reads the same token through a Compose secret with `authorization.credentials_file`.
- Business metrics are emitted from a route-level `finish` listener that counts only `2xx`/`3xx` responses after `tenantRouteHandler` has committed. No response-object callback field is added to `TenantRouteResponse`.
- `/metrics` and `/api/health*` are excluded from HTTP request metrics.
- Unknown HTTP methods are labeled `OTHER`. Route labels are Express route patterns, never raw URLs.
- The in-flight gauge is decremented exactly once per counted request, including aborted requests. Unfinished requests are not added to the request counter or latency histogram.
- Business metrics cover only implemented backend behavior, with label values drawn from bounded enums.
- The database probe runs every 15 seconds, executes `SELECT 1`, has a bounded timeout, never overlaps itself, and runs once at startup. Status, latency, and timestamp are updated on both success and failure.
- Alerts use minimum traffic/sample thresholds and compute numerator and denominator separately.
- Prometheus image: `prom/prometheus:v3.16.0`. Grafana image: `grafana/grafana:13.2.5`.
- Retention is 15 days. Prometheus and Grafana each use a named volume.

---

## 3. Architecture

```
┌──────────────────────────────────────────────┐
│ Host                                          │
│                                               │
│  PayPilot Express API                         │
│  HOST=0.0.0.0, PORT=4000                      │
│  GET /metrics  ── bearer token required       │
│  HTTP + business + DB probe instrumentation   │
│                                               │
└──────────────────────┬───────────────────────┘
                       │ host.docker.internal:4000
                       │ (Docker bridge; host firewall restricts 4000)
┌──────────────────────▼───────────────────────┐
│ Docker Compose                                │
│                                               │
│  Prometheus  (127.0.0.1:9090)                 │
│  15s scrape · 15d TSDB · alert rules          │
│                                               │
│  Grafana     (127.0.0.1:3000)                 │
│  provisioned Prometheus datasource            │
│  two provisioned dashboards                   │
│                                               │
│  Named volumes:                               │
│   paypilot-prometheus-data                    │
│   paypilot-grafana-data                       │
└───────────────────────────────────────────────┘
```

- Prometheus and Grafana talk over Docker service DNS (`http://prometheus:9090`).
- No Alertmanager is added. Firing alerts are visible in the Prometheus UI (`/alerts`) and in a Grafana panel.
- No metrics are exposed through the web app, the Vite dev proxy, or CORS.

---

## 4. API instrumentation

### 4.1 Package and registry

Add `@prometheus-io/client@0.16.1` to `apps/api`.

Create `apps/api/src/lib/metrics.ts` as the single registry and metric-definition module:

- Create one `Registry`.
- Call `collectDefaultMetrics({ register, prefix: 'paypilot_' })` once.
- Define all custom metrics against that registry.
- Export the registry, the metric objects, and the middleware/helper functions.
- Do not register metrics anywhere else.

Default metric names therefore include `paypilot_process_cpu_seconds_total`, `paypilot_process_resident_memory_bytes`, `paypilot_nodejs_eventloop_lag_seconds`, `paypilot_nodejs_active_handles_total`, `paypilot_nodejs_heap_size_used_bytes`, and `paypilot_process_start_time_seconds`. Only the subset used by dashboards is documented; the rest remain available for ad hoc queries.

### 4.2 HTTP metrics

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `paypilot_http_requests_total` | Counter | `method`, `route`, `status` | One increment per completed request |
| `paypilot_http_request_duration_seconds` | Histogram | `method`, `route`, `status` | Buckets: `0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10` |
| `paypilot_http_requests_in_flight` | Gauge | none | Current in-flight counted requests |

- `status` is the final numeric status code as a string. The set is bounded by valid HTTP status codes.
- Duration uses a monotonic clock (`process.hrtime.bigint()`), not wall-clock time.
- The histogram bucket list is versioned as `http_duration_buckets_v1` in a code comment. Changing buckets requires updating dashboard and alert queries in the same change.
- Do not add request/response body size, user agent, IP address, organization, employee, or request-ID labels.

### 4.3 Route and method normalization

- `method`: allowlist `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`. Any other method becomes `OTHER`.
- `route`: use the matched Express route pattern assembled from `req.baseUrl` and `req.route.path`:
  - `GET /api/attendance` → `/api/attendance`
  - `POST /api/attendance/punch` → `/api/attendance/punch`
  - `PATCH /api/leave-requests/:id/review` → `/api/leave-requests/:id/review`
  - `GET /api/payroll-imports/:id/records` → `/api/payroll-imports/:id/records`
  - `GET /api/employees?search=...` → `/api/employees`
- If no route matched (404) or `req.route.path` is not a string, use `route="unmatched"`.
- Normalize duplicate slashes and trailing slashes.
- Never use `req.originalUrl`, `req.url`, a UUID, an employee/organization ID, an email, a filename, or a query parameter as a label value.
- Exclusion check: `req.path === '/metrics'`, `req.path === '/api/health'`, or `req.path.startsWith('/api/health/')`. `/metrics` is also mounted before the middleware, so the check is defense in depth.
- Excluded requests do not increment the counter, observe the histogram, or change the in-flight gauge.

### 4.4 In-flight lifecycle

The HTTP metrics middleware is registered once at the app level:

1. If the path is excluded, call `next()` without touching metrics.
2. Increment `paypilot_http_requests_in_flight`.
3. Attach a `finish` listener and a `close` listener.
4. Use a per-request `settled` flag so the gauge is decremented exactly once.
5. On `finish`: decrement once, increment `paypilot_http_requests_total`, and observe the duration histogram with the final status.
6. On `close` without `finish`: decrement once and do not increment the counter or observe the histogram. Aborted requests are therefore not counted as completed requests.
7. `close` firing after `finish` is a no-op because of the `settled` guard.

The middleware must not throw if the response has already ended or if a listener is attached after the response is finished.

### 4.5 Business metrics

| Metric | Type | Labels | Emitted when |
|---|---|---|---|
| `paypilot_attendance_punches_total` | Counter | `action` ∈ `in`, `out` | A punch commits and responds `2xx`/`3xx` |
| `paypilot_leave_requests_created_total` | Counter | `leave_type` ∈ `ANNUAL`, `SICK`, `CASUAL`, `MATERNITY`, `PATERNITY`, `UNPAID`, `BEREAVEMENT` | A leave request commits and responds `2xx`/`3xx` |
| `paypilot_leave_reviews_total` | Counter | `decision` ∈ `approve`, `reject` | A review commits and responds `2xx`/`3xx` |
| `paypilot_payroll_imports_total` | Counter | `status` ∈ `COMPLETED`, `FAILED` | An import batch is persisted and the route responds `2xx`/`3xx` |

- Initialize every bounded label combination with `.inc(0)` at startup so dashboards show zero instead of "no data" and so an accidental unbounded label value is visible in review.
- Use the Prisma `LeaveType` enum to build the leave-type label list, so adding an enum value without updating metrics is a compile-time or test-time failure.
- Do not label with employee IDs, organization IDs, leave request IDs, dates, filenames, amounts, or free text.

**Commit semantics.** Add a helper such as:

```ts
export function onRequestSuccess(req: Request, callback: () => void): void {
  const res = req.res;
  if (!res) return;
  res.on('finish', () => {
    if (res.statusCode >= 200 && res.statusCode < 400) {
      callback();
    }
  });
}
```

Route handlers call it after the service call and before returning the response. `tenantRouteHandler` passes `(req, tx)` to the handler, so the helper uses the Express `req.res` reference rather than changing the handler signature:

```ts
const record = await punchAttendance(tx, organizationId, userId, input);
onRequestSuccess(req, () => attendancePunchesTotal.inc({ action: input.action }));
return { body: { success: true, data: { record } } };
```

- `tenantRouteHandler` commits before sending the response, so `finish` implies the transaction committed.
- If the transaction rolls back or the handler throws, `tenantRouteHandler` sends an error status and the callback does not run.
- If the client disconnects after commit but before `finish`, the business change is committed but the counter may miss it. Business metrics are best-effort observability, not billing records.
- For payroll imports, use the persisted batch `status`, so a file-level failure persisted as `FAILED` and returned as `201` increments `status="FAILED"`.

### 4.6 Database probe

Create a dedicated `apps/api/src/lib/dbProbe.ts` rather than changing the existing `/api/health/db` behavior.

| Metric | Type | Meaning |
|---|---|---|
| `paypilot_db_up` | Gauge | `1` after a successful probe, `0` after a failure or timeout |
| `paypilot_db_probe_duration_seconds` | Gauge | Duration of the most recent probe |
| `paypilot_db_last_probe_timestamp_seconds` | Gauge | Unix timestamp of the most recent completed probe attempt |

Behavior:

- Interval: 15 seconds (`DB_PROBE_INTERVAL_MS = 15_000`).
- Timeout: 2 seconds (`DB_PROBE_TIMEOUT_MS = 2_000`).
- Query: `SELECT 1` inside a short interactive transaction that runs `SET LOCAL statement_timeout = 2000` first, so the database enforces the bound. A client-side timeout guard is added as defense in depth.
- First probe: run once at startup, without blocking `app.listen`.
- No overlap: a module-level `inFlight` flag skips a tick if the previous probe is still running. The skip is logged at debug level and does not change the gauges.
- On success: `db_up = 1`, update duration and timestamp.
- On failure or timeout: `db_up = 0`, update duration and timestamp, and log a warning with the error message only. Never log the connection string or credentials.
- Initial values before the first probe: `db_up = 0`, duration `0`, timestamp `0`.
- `startDbProbe()` returns a `stop()` function. `server.ts` calls it after startup and stops it during graceful shutdown (`clearInterval`).
- Use `.unref()` on the interval so the probe does not keep the process alive by itself.

### 4.7 `/metrics` authentication and CORS

Create `apps/api/src/lib/metricsAuth.ts`:

- `loadMetricsToken(filePath: string): string` reads the file synchronously at startup, trims surrounding whitespace, and throws if the file is missing, unreadable, or empty.
- Relative `METRICS_TOKEN_FILE` paths resolve from the repository root, not `process.cwd()`, because workspace scripts run with different working directories.
- `createMetricsAuthMiddleware(token: string)`:
  - Extracts `Authorization: Bearer <token>` case-insensitively.
  - Hashes both the expected and provided values with SHA-256, then compares the fixed-length digests with `crypto.timingSafeEqual`.
  - Returns `401` with `WWW-Authenticate: Bearer` and no token details for a missing or invalid token.
  - Never logs the header or token. A rejection may be logged at debug level with method and path only.
- `server.ts` loads the token once and passes it to the middleware. A token rotation requires an API restart.
- `/metrics` is mounted **before** `app.use(cors(...))`, so the metrics response never carries `Access-Control-Allow-Origin`.
- The metrics response sets `Content-Type: register.contentType`, `Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`.
- The route is `GET /metrics`, outside `/api`. It is not added to the Vite proxy or any frontend client.

### 4.8 Configuration

Add to `apps/api/src/config/env.ts`:

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `0.0.0.0` | Interface the API listens on |
| `METRICS_TOKEN_FILE` | `./.secrets/paypilot_metrics_token` | Path to the bearer token file; relative paths resolve from the repo root |

- `app.listen(config.PORT, config.HOST, ...)`.
- Add `REPO_ROOT` and `resolveRepoPath()` helpers in `config/env.ts` or a small `config/paths.ts`.
- Keep the existing `NODE_ENV=test` fallback config working. The token file is loaded only by `server.ts`, so unit tests that import routers or the metrics module do not need a token file.
- Update `.env.example` with `HOST`, `METRICS_TOKEN_FILE`, and the Compose-only variables: `PROMETHEUS_PORT`, `GRAFANA_PORT`, `GRAFANA_ADMIN_USER`, `GRAFANA_ADMIN_PASSWORD`.
- Add `.secrets/` to `.gitignore`.

### 4.9 Server wiring order

The order in `apps/api/src/server.ts` is load-bearing:

1. `app.get('/metrics', metricsAuth, metricsHandler)` — before CORS, body parsers, the request logger, and the HTTP metrics middleware.
2. `app.use(cors(...))`.
3. `app.use(httpMetricsMiddleware)` — before body parsers so upload and JSON parsing time is included in the duration histogram.
4. `app.use(express.json())` and `app.use(express.urlencoded(...))`.
5. `app.use(requestLogger)`.
6. `app.use('/api', apiRouter)`.
7. The existing 404 handler and `errorHandler`.
8. Start the DB probe, then `app.listen(config.PORT, config.HOST, ...)`.

This order guarantees that `/metrics` never receives CORS headers, body parsing, request logging, or HTTP request metrics. Health routes still pass through the metrics middleware but are excluded by the path check.

---

## 5. Prometheus

### 5.1 Compose service

Add to `docker-compose.yml`:

```yaml
prometheus:
  image: prom/prometheus:v3.16.0
  container_name: paypilot-prometheus
  restart: unless-stopped
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

Top-level:

```yaml
secrets:
  paypilot_metrics_token:
    file: ./.secrets/paypilot_metrics_token
```

- The Compose secret is mounted at `/run/secrets/paypilot_metrics_token`, readable by the Prometheus container without loosening host file permissions.
- The host token file stays `0600` and the `.secrets/` directory stays `0700`.
- Generate the token without a trailing newline:

```bash
mkdir -p .secrets
chmod 700 .secrets
printf '%s' "$(openssl rand -hex 32)" > .secrets/paypilot_metrics_token
chmod 600 .secrets/paypilot_metrics_token
```

### 5.2 Scrape configuration

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

- `scrape_timeout` (10s) is less than `scrape_interval` (15s).
- `credentials_file` is read per scrape, so Prometheus can pick up a rotated token on its next scrape. The API still needs a restart because it caches the token.
- The target is the host-run API. If the API is later containerized, replace `host.docker.internal:4000` with the service DNS name.

### 5.3 Alert rules

Create `docker/prometheus/alerts.yml` with these rules:

| Alert | Expression intent | Threshold | `for` | Severity |
|---|---|---|---|---|
| `PayPilotApiDown` | `up{job="paypilot-api"} == 0` | target unreachable | `2m` | critical |
| `PayPilotHigh5xxRate` | 5xx requests / all requests | `> 5%` and at least 50 requests in 5m | `10m` | warning |
| `PayPilotHighP95Latency` | histogram p95 | `> 1s` and at least 50 requests in 5m | `10m` | warning |
| `PayPilotDatabaseDown` | `paypilot_db_up == 0` with a fresh probe | failure for 2m | `2m` | critical |
| `PayPilotDatabaseProbeStale` | `time() - last_probe_timestamp > 60` | probe older than 60s | `5m` | warning |

Key expressions:

```yaml
# PayPilotHigh5xxRate
(
  sum(rate(paypilot_http_requests_total{job="paypilot-api",status=~"5.."}[5m]))
  /
  clamp_min(sum(rate(paypilot_http_requests_total{job="paypilot-api"}[5m])), 1e-9)
) > 0.05
and
sum(increase(paypilot_http_requests_total{job="paypilot-api"}[5m])) >= 50
```

```yaml
# PayPilotHighP95Latency
histogram_quantile(
  0.95,
  sum by (le) (rate(paypilot_http_request_duration_seconds_bucket{job="paypilot-api"}[5m]))
) > 1
and
sum(increase(paypilot_http_request_duration_seconds_count{job="paypilot-api"}[5m])) >= 50
```

```yaml
# PayPilotDatabaseDown
paypilot_db_up{job="paypilot-api"} == 0
and
(time() - paypilot_db_last_probe_timestamp_seconds{job="paypilot-api"}) < 60
```

- The 5xx ratio aggregates the numerator and denominator separately, then divides. It does not divide per-route series and average afterward.
- The latency alert uses the same `le` aggregation as the dashboard. Bucket changes must update both.
- The minimum traffic/sample thresholds prevent low-traffic noise and single-request spikes from paging.
- `PayPilotDatabaseDown` requires a fresh probe, so a dead API triggers `PayPilotApiDown` instead of a stale DB alert. `PayPilotDatabaseProbeStale` covers the case where the API is up but the probe loop stopped.
- Every alert has `summary` and `description` annotations with no secrets or user data.
- No Alertmanager configuration is added.

### 5.4 Rule tests

Create `docker/prometheus/tests/alerts.test.yml` and validate it with `promtool test rules`.

Coverage:

- `PayPilotApiDown` fires after 2 minutes of `up == 0`.
- `PayPilotHigh5xxRate` does not fire below 5%.
- `PayPilotHigh5xxRate` does not fire above 5% when traffic is below the 50-request minimum.
- `PayPilotHigh5xxRate` fires above 5% with enough traffic after the `for` window.
- `PayPilotHighP95Latency` does not fire below 1s or below the sample minimum.
- `PayPilotHighP95Latency` fires above 1s with enough samples after the `for` window.
- `PayPilotDatabaseDown` fires with a fresh failing probe.
- `PayPilotDatabaseDown` does not fire with a stale probe.
- `PayPilotDatabaseProbeStale` fires when the timestamp is older than 60s.

Use container paths in the test file so it runs inside the Prometheus container:

```yaml
rule_files:
  - /etc/prometheus/alerts.yml
```

Verification commands:

```bash
docker-compose exec prometheus promtool check config /etc/prometheus/prometheus.yml
docker-compose exec prometheus promtool check rules /etc/prometheus/alerts.yml
docker-compose exec prometheus promtool test rules /etc/prometheus/tests/alerts.test.yml
```

---

## 6. Grafana

### 6.1 Compose service

Add to `docker-compose.yml`:

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

- Grafana's SQLite state persists in `paypilot-grafana-data`.
- Anonymous access and sign-up are disabled. The admin password comes from `.env`.
- The UI is bound to `127.0.0.1` only.

### 6.2 Provisioning

Create:

- `docker/grafana/provisioning/datasources/prometheus.yml`
  - Datasource name `Prometheus`, UID `paypilot-prometheus`, type `prometheus`, URL `http://prometheus:9090`, default, not editable.
- `docker/grafana/provisioning/dashboards/paypilot.yml`
  - File provider, folder `PayPilot`, path `/var/lib/grafana/dashboards`, `disableDeletion: true`, `allowUiUpdates: false`, `updateIntervalSeconds: 30`.
- `docker/grafana/dashboards/api-overview.json`
  - UID `paypilot-api-overview`.
- `docker/grafana/dashboards/business-activity.json`
  - UID `paypilot-business-activity`.

Dashboards reference the datasource by UID so renaming the datasource does not break panels. Dashboard JSON is hand-maintained; UI edits are not persisted back to the files and are overwritten on restart. Export changes back to JSON if a panel is edited in the UI.

### 6.3 API Overview dashboard

Default time range: last 6 hours. Refresh: 30 seconds.

Panels:

- **Stats:** API target up (`up{job="paypilot-api"}`), DB up (`paypilot_db_up`), process uptime (`time() - paypilot_process_start_time_seconds`), in-flight requests (`paypilot_http_requests_in_flight`).
- **Request rate by status:** `sum by (status) (rate(paypilot_http_requests_total{route=~"$route"}[$__rate_interval]))`.
- **5xx ratio:** numerator and denominator aggregated separately, with `clamp_min` on the denominator.
- **Latency:** p50/p95/p99 from `histogram_quantile` over `sum by (le) (rate(paypilot_http_request_duration_seconds_bucket{route=~"$route"}[$__rate_interval]))`.
- **In-flight requests:** `paypilot_http_requests_in_flight`.
- **Process CPU and memory:** `rate(paypilot_process_cpu_seconds_total[$__rate_interval])` and `paypilot_process_resident_memory_bytes`.
- **Event loop and handles:** `paypilot_nodejs_eventloop_lag_seconds` and `paypilot_nodejs_active_handles_total`.
- **Database probe:** `paypilot_db_probe_duration_seconds` and `time() - paypilot_db_last_probe_timestamp_seconds`.
- **Top routes table:** `topk(10, sum by (route) (rate(paypilot_http_requests_total[$__rate_interval])))`.
- **Route variable:** multi-select from `label_values(paypilot_http_requests_total, route)`, default `All`.

Use `$__rate_interval` in dashboard queries so panels adapt to the selected time range. Alerts use fixed 5-minute windows.

### 6.4 Business Activity dashboard

Default time range: last 7 days. Refresh: 30 seconds.

Panels:

- **Stats (last 24h):**
  - Attendance punches in: `sum(increase(paypilot_attendance_punches_total{action="in"}[24h]))`
  - Attendance punches out: `sum(increase(paypilot_attendance_punches_total{action="out"}[24h]))`
  - Leave requests created: `sum(increase(paypilot_leave_requests_created_total[24h]))`
  - Leave reviews: `sum(increase(paypilot_leave_reviews_total[24h]))`
  - Payroll imports: `sum(increase(paypilot_payroll_imports_total[24h]))`
- **Punch rate by action:** `sum by (action) (rate(paypilot_attendance_punches_total[$__rate_interval]))`.
- **Leave requests by type:** `sum by (leave_type) (increase(paypilot_leave_requests_created_total[$__range]))`.
- **Leave reviews by decision:** `sum by (decision) (increase(paypilot_leave_reviews_total[$__range]))`.
- **Payroll imports by status:** `sum by (status) (increase(paypilot_payroll_imports_total[$__range]))`.
- **Totals table:** current value per label combination over the selected range.

Business panels use `or vector(0)` where a zero result is more useful than "no data". Label values are bounded enums, so the number of series stays small.

---

## 7. Security

- `/metrics` always requires a bearer token; there is no open mode.
- The token is read from a file, never from an environment variable value, and never logged. Only the file path and a loaded/not-loaded boolean may be logged.
- Token comparison hashes both values with SHA-256 and uses `crypto.timingSafeEqual`, avoiding length leaks and timing side channels.
- The token file is excluded from git (`.secrets/`) and is not committed. Compose mounts it as a secret rather than embedding it in `docker-compose.yml`.
- `/metrics` is mounted before CORS, so it never emits `Access-Control-Allow-Origin`. It is not proxied by Vite and is not called by the web app.
- Grafana anonymous access and sign-up are disabled. The admin password comes from `.env`; `.env` is already ignored.
- Prometheus and Grafana publish only on `127.0.0.1`.
- The API binds to `0.0.0.0` so the Docker bridge can reach it. This requires a host firewall rule restricting port 4000 to the Docker bridge subnet. Example (adapt the subnet to the actual bridge, e.g. from `docker network inspect bridge --format '{{(index .IPAM.Config 0).Subnet}}'`):

```bash
sudo iptables -N PAYPILOT_API 2>/dev/null || true
sudo iptables -F PAYPILOT_API
sudo iptables -A PAYPILOT_API -s 127.0.0.0/8 -j ACCEPT
sudo iptables -A PAYPILOT_API -s 172.16.0.0/12 -j ACCEPT
sudo iptables -A PAYPILOT_API -j DROP
sudo iptables -I INPUT -p tcp --dport 4000 -j PAYPILOT_API
```

- No TLS is configured. This is a local development setup, not a production deployment.
- No Alertmanager or notification credentials are added.
- The Prometheus UI has no authentication and is localhost-only. Do not publish it on a public interface.

---

## 8. Testing and verification

### 8.1 Unit tests

Add `apps/api/src/lib/metrics.test.ts` (and focused tests for the auth and probe modules):

- Registry contains the HTTP, business, and DB metrics with the expected types.
- Method normalization: known methods pass through; unknown methods become `OTHER`.
- Route normalization:
  - `req.baseUrl` + `req.route.path` produces the expected pattern.
  - Trailing and duplicate slashes are normalized.
  - Unmatched routes become `unmatched`.
  - Non-string route paths fall back safely.
  - Query strings and UUIDs never appear in labels.
- Exclusion matcher:
  - `/metrics`, `/api/health`, and `/api/health/db` are excluded.
  - `/api/employees` is not excluded.
  - `/api/healthcheck` is not accidentally excluded.
- HTTP lifecycle:
  - `finish` increments the counter and observes the histogram, and leaves the in-flight gauge at zero.
  - `close` without `finish` decrements the gauge once and does not increment the counter or histogram.
  - `finish` followed by `close` decrements only once.
- Business success listener:
  - `200`, `201`, and `302` run the callback.
  - `400` and `500` do not.
- Metrics auth:
  - Correct token calls `next()`.
  - Missing and wrong tokens return `401` with `WWW-Authenticate: Bearer`.
  - `Bearer` is matched case-insensitively.
  - The token is never written to the logger (spy on the logger).
- DB probe:
  - Success sets `db_up = 1`, updates duration and timestamp.
  - Failure sets `db_up = 0`, updates duration and timestamp.
  - Timeout sets `db_up = 0` and records the bounded duration.
  - A second concurrent probe is skipped.
  - The first probe runs at startup.
  - `stop()` clears the interval.

### 8.2 Integration tests

Extend `apps/api/src/features/attendance/attendanceLeave.integration.test.ts` (the suite already owns the `aaaa`/`bbbb` fixture range; no new fixture range is needed):

- Mount `createHttpMetricsMiddleware()` and the authenticated `/metrics` route in the suite's test app.
- After a successful punch, `GET /metrics` with the token contains `paypilot_attendance_punches_total{action="in"} 1`.
- After a rejected punch (`400`), the counter value is unchanged (read a baseline before the failed request).
- `GET /metrics` without a token returns `401`.
- `GET /api/health` and `GET /api/health/db` do not create `route="/api/health..."` series.
- An unknown route appears as `route="unmatched"`, not as the raw URL.
- A request with a UUID path parameter and a query string does not put the UUID or query string into any label.

Use the exported registry's `getSingleMetric(...).get()` helper or parse the `/metrics` body to read baseline and post-request values. Keep assertions resilient to other tests running earlier in the same process.

### 8.3 Prometheus rule tests

Run the three `promtool` commands from section 5.4. `promtool check config` validates the scrape and rule file paths; `promtool check rules` validates the rule syntax; `promtool test rules` validates the alert behavior.

### 8.4 Manual verification

1. Generate the token file and confirm `.secrets/` is ignored.
2. Start the API and Compose: `docker-compose up -d prometheus grafana`.
3. `curl -i http://localhost:4000/metrics` → `401`.
4. `curl -i -H "Authorization: Bearer wrong" http://localhost:4000/metrics` → `401`.
5. `curl -s -H "Authorization: Bearer $(cat .secrets/paypilot_metrics_token)" http://localhost:4000/metrics` → `200`, with `paypilot_http_requests_total` and the business metrics present.
6. `curl -i -H "Origin: http://localhost:5173" http://localhost:4000/metrics` → no `Access-Control-Allow-Origin`.
7. Prometheus targets page (`http://localhost:9090/targets`) shows `paypilot-api` `UP`.
8. Prometheus alerts page (`http://localhost:9090/alerts`) shows the five rules.
9. Grafana (`http://localhost:3000`) loads the Prometheus datasource and both dashboards; anonymous access redirects to login.
10. Trigger a punch and a leave request, then confirm the business panels move.
11. Stop the API and confirm `PayPilotApiDown` fires after 2 minutes; restart and confirm it resolves.
12. Run the full test suite: `npm run typecheck`, `npm run typecheck:tests --workspace=apps/api`, `npm run build`, `npm test`, and `npm run test:integration` with `RUN_DB_INTEGRATION=1` and `DIRECT_URL`.

### 8.5 Acceptance criteria

- `/metrics` returns `401` without a token and `200` with the correct token.
- Prometheus scrapes the API successfully and shows the target as `UP`.
- Both provisioned dashboards load and render data.
- All five alert rules load, and `promtool test rules` passes.
- Business counters increment only after committed, successful responses.
- `/metrics` and `/api/health*` never appear in HTTP request metrics.
- No token appears in logs, git, Compose config, or dashboard JSON.
- Prometheus retains 15 days of data in `paypilot-prometheus-data`; Grafana state persists in `paypilot-grafana-data`.
- The full typecheck, build, unit, and integration suites pass.

---

## 9. Documentation

- Add an **Observability** section to `README.md` covering:
  - The architecture and the host-vs-Docker boundary.
  - Token generation and `.secrets/` permissions.
  - Start/stop commands and URLs.
  - Grafana credentials from `.env`.
  - The firewall requirement for port 4000.
  - Links to the detailed metric, dashboard, and alert catalog.
- Add `docs/OBSERVABILITY.md` with:
  - The metric catalog (name, type, labels, meaning).
  - The label/cardinality policy.
  - The dashboard catalog.
  - The alert catalog with thresholds, `for` windows, and the minimum-traffic rationale.
  - `promtool` verification commands.
  - Troubleshooting: `host.docker.internal` resolution, firewall rules, token mismatch, Prometheus target down, Grafana datasource health.
  - Security limitations: local-only, no TLS, no Alertmanager, static token.
  - How to add a metric: define it in `lib/metrics.ts`, use bounded labels, initialize zero values, add tests, update dashboards/alerts, and version bucket changes.
- Document that dashboards are provisioned from JSON and UI edits are overwritten.
- Document that changing histogram buckets requires updating the dashboard and alert queries together.

---

## 10. Risks and limitations

- **Host/Docker coupling:** Prometheus scrapes a host-run API. If the API is later containerized, the target must change to the service DNS name.
- **Firewall dependency:** `HOST=0.0.0.0` is required for the Docker bridge to reach the API. A missing or incorrect firewall rule exposes port 4000 to the LAN. The README must make this prominent.
- **Best-effort business metrics:** A crash or client disconnect after commit but before `finish` can miss a count. These metrics are not suitable for billing or audit.
- **Histogram bucket drift:** Changing the duration buckets silently changes p95/p99 results. Bucket changes must update dashboards, alerts, and the rule tests together.
- **Static token:** Rotating the token requires an API restart; Prometheus picks up the new file on its next scrape. No automatic rotation is provided.
- **No Alertmanager:** Alerts are visible in Prometheus and Grafana but are not delivered anywhere.
- **No tracing or logs:** Metrics only. OpenTelemetry, Loki, and Tempo are intentionally out of scope.
- **Prometheus UI has no auth:** It is localhost-only; do not expose it publicly.
- **Grafana provisioning overwrites UI edits:** Export changes back to JSON or they are lost on restart.
- **Disk growth:** 15-day retention bounds TSDB age, not cardinality. The label policy is the primary protection.
- **Local Compose secrets:** The token is protected by host file permissions and Compose secret mounting, not encryption at rest.

---

## 11. Delivery

- Switch to `main` and create `feat/observability`.
- Preserve the unrelated uncommitted web changes (`DashboardPage.tsx`, `DepartmentsPage.tsx`, `SettingsPage.tsx`); do not include them in this branch or commit them with observability work.
- No schema or migration changes.
- Suggested commits:
  1. `chore(api): add @prometheus-io/client and metrics registry`
  2. `feat(api): expose authenticated metrics and instrument HTTP, business, and DB health`
  3. `feat(infra): add Prometheus and Grafana to Compose with provisioning`
  4. `test(api): cover metrics auth, lifecycle, route labels, and business counters`
  5. `docs: document observability setup, metrics, dashboards, and alerts`
- Open a PR to `main` with the verification output. Do not merge until review.
- No history rewrites, force pushes, or unrelated staging.
