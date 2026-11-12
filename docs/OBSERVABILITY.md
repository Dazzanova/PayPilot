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

The ports above are defaults; `PROMETHEUS_PORT` and `GRAFANA_PORT` can override them.

- The API runs on the host. Prometheus reaches it through `host.docker.internal` and the Docker network.
- The API must be running (`npm run dev:api` or `npm run dev`) for the scrape target to be `up`.
- Prometheus and Grafana run in Docker Compose and publish only on `127.0.0.1`.
- `/metrics` is mounted before CORS and is never proxied by the web app.
- There is no OpenTelemetry, tracing, log aggregation, Alertmanager, or Kubernetes.

### Token permissions and `HOST_GID`

The token file must stay non-world-readable while still being readable by Prometheus inside its container:

```bash
mkdir -p .secrets
chmod 700 .secrets
printf '%s' "$(openssl rand -hex 32)" > .secrets/paypilot_metrics_token
chmod 640 .secrets/paypilot_metrics_token
```

- `.secrets/` is `0700` and git-ignored; the token is `0640`.
- The Compose secret bind-mounts the host file with its owner and mode intact, so the container sees the same `0640` permissions.
- Prometheus runs as `nobody` and joins the host group via `group_add: ["${HOST_GID:-1000}"]` in `docker-compose.yml`. Set `HOST_GID` in `.env` to the group that owns the token so the scrape can read it without making the token world-readable.
- Check the group with `stat -c '%g' .secrets/paypilot_metrics_token` on Linux, or `stat -f '%g' .secrets/paypilot_metrics_token` on macOS.

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
- `paypilot_nodejs_eventloop_lag_p99_seconds`
- `paypilot_nodejs_active_handles_total`

The event loop lag panel plots `paypilot_nodejs_eventloop_lag_p99_seconds`. The full distribution is also exported as `paypilot_nodejs_eventloop_lag_seconds` if you need other quantiles.

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

Both dashboards are provisioned from JSON with `editable: false` (and `allowUiUpdates: false` in the provider). UI edits are not persisted: the provisioned files are re-applied on restart and overwrite unsaved changes.

### PayPilot API Overview (`paypilot-api-overview`)

Default range: 6 hours. Refresh: 30 seconds.

- Stats: API target up, DB up, process uptime, in-flight requests.
- Request rate by status.
- 5xx ratio (numerator and denominator aggregated separately).
- Latency p50/p95/p99.
- In-flight requests.
- Process CPU and resident memory.
- Event loop lag (`paypilot_nodejs_eventloop_lag_p99_seconds`) and active handles.
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
- `PayPilotDatabaseProbeStale` covers an API that is up but whose probe loop stopped. It is additionally guarded by `up{job="paypilot-api"} == 1`, so it cannot fire while the API itself is down.
- No Alertmanager is configured; alerts are visible in Prometheus (`/alerts`) and Grafana.

Validate the rules with the pinned image:

```bash
docker-compose exec prometheus /bin/promtool check config /etc/prometheus/prometheus.yml
docker-compose exec prometheus /bin/promtool check rules /etc/prometheus/alerts.yml
docker-compose exec prometheus /bin/promtool test rules /etc/prometheus/tests/alerts.test.yml
```

The stack does not enable the Prometheus lifecycle API, so rule files are not hot-reloaded. After editing `docker/prometheus/alerts.yml`, apply it with:

```bash
docker-compose restart prometheus
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
- Confirm an `extra_hosts` entry for `host.docker.internal:host-gateway` is present in `docker-compose.yml`.
- Check host firewall rules for port 4000 (see [README §10.4](../README.md#104-firewall-requirement-linux)).

### Prometheus gets `401`

- Confirm `/run/secrets/paypilot_metrics_token` exists inside the container.
- Confirm `.secrets/paypilot_metrics_token` exists on the host and is readable by the Compose secret mount.
- Verify the container joined the host group: `docker-compose exec prometheus id` should list the host gid (for example `1000`).
- Confirm `HOST_GID` in `.env` matches the token file's group: `stat -c '%g' .secrets/paypilot_metrics_token` on Linux, `stat -f '%g' .secrets/paypilot_metrics_token` on macOS.
- Confirm the API was restarted after the token changed.
- Do not add the token to the scrape URL or logs.

### Grafana has no data

- Open `Connections → Data sources → Prometheus` and use **Test** (the datasource is provisioned read-only, so it cannot be saved from the UI).
- Confirm the datasource URL is `http://prometheus:9090` (service DNS, not localhost).
- Confirm the Prometheus target is `UP`.
- Confirm the dashboard uses UID `paypilot-prometheus`.

### Grafana admin password

`GF_SECURITY_ADMIN_PASSWORD` is only applied when the Grafana data volume is first initialized. Changing `.env` later does not change an existing admin password.

- To change it, use the Grafana UI/API while signed in as an admin.
- Or remove the `paypilot-grafana-data` volume and let Grafana reinitialize — this also deletes all Grafana state, including any local users and preferences.

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
- The token is protected by host file permissions (`0640`, directory `0700`), the `HOST_GID` group join, and Compose secret mounting, not encryption at rest.

---

## 9. Adding a metric

1. Define it in `apps/api/src/lib/metrics.ts` against the shared registry.
2. Use bounded labels only.
3. Initialize zero values for every bounded label combination.
4. Add unit tests for definitions and behavior.
5. Add integration coverage when the metric depends on a route.
6. Update the dashboard JSON and, if alertable, `docker/prometheus/alerts.yml` plus its rule tests.
7. Run `promtool check config`, `promtool check rules`, and `promtool test rules`.
8. Apply rule changes with `docker-compose restart prometheus`; dashboards reload from JSON within about 30 seconds.
