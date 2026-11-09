# Payroll Import & Integrity Validation Design

**Status:** Approved 2026-11-07
**Branch:** `feat/payroll-import-validation`
**Scope:** One documented CSV payroll-register format, persisted import batches, deterministic validation findings, history/detail APIs, and a Payroll Imports UI.

---

## 1. Goals

- Let an authorized HR user upload a payroll register and receive persisted, explainable validation results.
- Resolve employee numbers against the authenticated organization's existing `Employee` records.
- Isolate imported records from finalized payroll runs and payslips.
- Keep validation deterministic, testable without Express or Prisma, and safe under concurrent uploads.
- Expose import history, detail, paginated records and findings, and a downloadable exception report.

**Out of scope:** external payroll providers, salary/tax/statutory calculations, finalized payroll runs, raw-file downloads, cross-batch duplicate record detection.

---

## 2. Decisions

- One currency per batch. The first structurally valid row sets the batch currency; rows with a different valid code receive `INCONSISTENT_CURRENCY` as an error.
- One payroll period per batch. The first valid row sets the batch period; rows with a different period receive `INCONSISTENT_PAY_PERIOD` as an error.
- Identical file hash: blocked with `409 DUPLICATE_IMPORT` only when a `COMPLETED` batch with that hash exists in the organization. A `FAILED` batch may be retried.
- Limits: 5 MB request payload and 10,000 data rows (excluding the header).
- Roles: `SUPER_ADMIN`, `ADMIN`, `HR_MANAGER`. `MANAGER` and `EMPLOYEE` receive 403.
- File-level failures are persisted as `FAILED` batches with file-level findings. Oversized payloads and duplicate imports are rejected before storage.
- Raw files retained for 90 days, then removed by an idempotent purge script; batch metadata, records, and findings remain.
- No new runtime dependencies: raw `text/csv` upload, in-repo RFC 4180 parser, Node `crypto` for SHA-256.

---

## 3. Data model

All three models carry `organizationId` and are covered by forced RLS.

### PayrollImportBatch

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | batch identifier, also used in the storage key |
| `organizationId` | uuid | FK organization, cascade |
| `createdById` | uuid? | FK user, set null on delete |
| `originalFilename` | text | sanitized for display only |
| `storageKey` | text? | null after retention purge |
| `fileHash` | char(64) | SHA-256 of the exact bytes |
| `fileSizeBytes` | int | |
| `rulesetVersion` | text | `payroll-import-rules/v1` |
| `status` | enum | `PROCESSING`, `COMPLETED`, `FAILED` |
| `rowCount` | int | data rows parsed |
| `validRowCount` | int | rows with no error findings |
| `invalidRowCount` | int | rows with at least one error |
| `errorCount` | int | finding counts |
| `warningCount` | int | |
| `infoCount` | int | |
| `currency` | char(3)? | batch currency when established |
| `payPeriodStart` | date? | batch period when established |
| `payPeriodEnd` | date? | |
| `retentionUntil` | timestamptz | createdAt + 90 days |
| `filePurgedAt` | timestamptz? | |
| `createdAt` | timestamptz | |
| `completedAt` | timestamptz? | |

Indexes: `(organizationId, createdAt)`, `(organizationId, status)`, `(organizationId, fileHash)`.

### ImportedPayrollRecord

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `organizationId` | uuid | FK organization, cascade |
| `batchId` | uuid | FK batch, cascade |
| `employeeId` | uuid? | resolved employee, set null on delete |
| `employeeNumber` | text | normalized from the file |
| `rowNumber` | int | data row position, 1-based after the header |
| `payPeriodStart` | date? | null when unparseable |
| `payPeriodEnd` | date? | |
| `currency` | char(3)? | null when invalid |
| `grossPay` | numeric(14,2)? | null when unparseable |
| `totalDeductions` | numeric(14,2)? | |
| `netPay` | numeric(14,2)? | |
| `isValid` | boolean | no error findings |
| `createdAt` | timestamptz | |

Indexes: `(organizationId, batchId)`, `(employeeId)`. No uniqueness on employee/period: duplicate rows must be stored so they can be explained.

### ValidationFinding

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `organizationId` | uuid | FK organization, cascade |
| `batchId` | uuid | FK batch, cascade |
| `recordId` | uuid? | FK record, cascade; null for file-level findings |
| `rowNumber` | int? | null for file-level findings |
| `field` | text? | CSV column name when applicable |
| `ruleCode` | text | stable code |
| `severity` | enum | `ERROR`, `WARNING`, `INFO` |
| `message` | text | human explanation, no salary values beyond the affected row context |
| `expected` | text? | |
| `actual` | text? | |
| `createdAt` | timestamptz | |

Indexes: `(organizationId, batchId, severity)`, `(batchId, rowNumber)`.

### RLS

- `paypilot_app`: `SELECT` and `INSERT` on all three tables; `UPDATE` on batches (status, counts, purge fields). No `DELETE`.
- `paypilot_migrator`: `ALL` policies for migrations and controlled scripts.
- Batch deletion cascades to records and findings. Imported records never reference payroll runs or payslips.

---

## 4. Storage and retention

- Root: `PAYROLL_IMPORT_STORAGE_DIR`, default `var/payroll-imports` resolved from the repository root.
- Path: `{organizationId}/{batchId}.csv`; directories `0700`, files `0600`.
- Never served statically; no raw-file download route.
- Original filename sanitized (basename, control characters removed, length capped) and stored for display.
- SHA-256 computed over the exact uploaded bytes.
- `retentionUntil = createdAt + 90 days`.
- `scripts/purge-payroll-imports.ts` scans batches past `retentionUntil` with a non-null `storageKey`, deletes the file when present, sets `storageKey = null` and `filePurgedAt`, and is safe to run repeatedly. Uses the migrator connection for the cross-tenant scan.

---

## 5. CSV format

```csv
employee_number,pay_period_start,pay_period_end,currency,gross_pay,total_deductions,net_pay
PP-1001,2026-10-01,2026-10-31,INR,75000.00,12500.00,62500.00
```

- UTF-8, optional BOM, comma delimiter.
- RFC 4180 quoting: quoted fields, escaped `""`, delimiters and newlines inside quotes.
- CRLF and LF row endings.
- Required header columns exactly as above. Duplicate or missing required headers are file-level failures.
- Extra columns are ignored and produce one batch-level `UNEXPECTED_COLUMN` warning.
- Empty files, unclosed quotes, and more than 10,000 data rows produce a persisted `FAILED` batch.
- A 5 MB body limit is enforced before parsing; oversized requests return 413 and are not stored.

---

## 6. Validation engine

Pure module with no Express or Prisma imports. Input: parsed rows plus an employee lookup map. Output: normalized records and findings. Ruleset version `payroll-import-rules/v1`.

### Structural findings

| Code | Severity | Scope |
|---|---|---|
| `EMPTY_FILE` | ERROR | batch |
| `INVALID_HEADER` | ERROR | batch |
| `CSV_PARSE_ERROR` | ERROR | batch |
| `TOO_MANY_ROWS` | ERROR | batch |
| `UNEXPECTED_COLUMN` | WARNING | batch |
| `MISSING_VALUE` | ERROR | row/field |
| `INVALID_DATE` | ERROR | row/field |
| `INVALID_PERIOD` | ERROR | row |
| `INVALID_CURRENCY` | ERROR | row/field |
| `INVALID_AMOUNT` | ERROR | row/field |
| `UNSUPPORTED_PRECISION` | ERROR | row/field |
| `UNKNOWN_EMPLOYEE` | ERROR | row |

### Integrity findings

| Code | Severity | Rule |
|---|---|---|
| `NEGATIVE_AMOUNT` | ERROR | any monetary value is below zero |
| `ARITHMETIC_MISMATCH` | ERROR | `gross_pay - total_deductions != net_pay` using decimal comparison |
| `DUPLICATE_EMPLOYEE_PERIOD` | ERROR | same employee and period appears more than once; every occurrence after the first is flagged |
| `INCONSISTENT_CURRENCY` | ERROR | row currency differs from the batch currency |
| `INCONSISTENT_PAY_PERIOD` | ERROR | row period differs from the batch period |
| `EMPLOYEE_INACTIVE` | WARNING | resolved employee status is not `ACTIVE`; does not invalidate a historical record |
| `PERIOD_BEFORE_JOIN_DATE` | WARNING | pay period starts before the employee's `joinedAt` |

- Rows with no `ERROR` findings are valid. Warnings and info do not invalidate.
- Inactive employees are never rejected solely for their status; the schema has no termination date, so no post-termination inference is made.
- Findings are ordered by row number, then by a fixed rule order, then by field. Identical normalized input produces identical output.
- Unknown employee numbers produce `UNKNOWN_EMPLOYEE`; no employee is created.
- Monetary parsing accepts `^\d{1,12}(\.\d{1,2})?$` after trimming. More than two decimals is `UNSUPPORTED_PRECISION`; other shapes are `INVALID_AMOUNT`; negatives are stored and flagged `NEGATIVE_AMOUNT`.
- Dates must be real ISO `YYYY-MM-DD` values; `pay_period_start` must not be after `pay_period_end`.
- Currency must match `^[A-Z]{3}$`.

---

## 7. API

Common behavior: Keycloak authentication, HR role authorization, tenant context from trusted auth state, responses sent only after commit.

| Method | Endpoint | Behavior |
|---|---|---|
| `POST` | `/api/payroll-imports` | Raw `text/csv`, `X-File-Name`; 201 batch summary, 409 duplicate, 413 oversized, 400 missing body |
| `GET` | `/api/payroll-imports` | Paginated history; `page`, `pageSize`, `status`; newest first |
| `GET` | `/api/payroll-imports/:id` | Batch detail and counts |
| `GET` | `/api/payroll-imports/:id/records` | Paginated records; `page`, `pageSize`, `valid=true|false` |
| `GET` | `/api/payroll-imports/:id/findings` | Paginated findings; `page`, `pageSize`, `severity`, `ruleCode` |
| `GET` | `/api/payroll-imports/:id/exception-report` | CSV attachment of all findings joined to their row values |

### Upload flow

1. Enforce role and 5 MB raw-body limit.
2. A request with no file body returns `400`. A zero-byte or whitespace-only file is a file-level failure and is persisted as a `FAILED` batch with `EMPTY_FILE`.
3. Compute SHA-256 and sanitize the filename.
4. Parse and normalize the CSV in memory.
5. Open the tenant transaction and take `pg_advisory_xact_lock(hashtext(organizationId), hashtext('payroll_import:' || hash))`.
6. Re-check for a `COMPLETED` batch with the same organization and hash; return 409 with the existing batch id when found.
7. Write the raw file to its final generated path.
8. Insert batch, records, and findings in chunks inside the transaction; update counts and status; write the audit entry; commit.
9. Delete the written file if the transaction fails.

### Exception report

- One row per finding, sorted by row number, rule code, then field.
- Columns: `row_number, employee_number, pay_period_start, pay_period_end, currency, gross_pay, total_deductions, net_pay, severity, rule_code, field, message, expected, actual`.
- All fields quoted and escaped; any cell beginning with `=`, `+`, `-`, or `@` is prefixed with `'` to prevent spreadsheet formula injection.
- `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="payroll-exceptions-<batchId>.csv"`, `Cache-Control: no-store`.

### Audit and logging

- Audit action `payroll_import.created` with batch id, status, row counts, and ruleset version only.
- No raw file contents, monetary values, employee names, employee numbers, or file hashes in logs or audit metadata.

---

## 8. Frontend

- Sidebar item **Payroll Imports** below Payroll.
- `/payroll/imports`: upload card with file picker, required format table and sample row, client-side size check, history table (filename, uploaded time, period, currency, status, rows, valid/invalid, findings), status filter, pagination, and View action.
- `/payroll/imports/:id`: summary cards, Findings and Records tabs with pagination, severity filter, validity filter, and Exception Report download.
- `MANAGER`/`EMPLOYEE` receive the API 403 and see the existing access-restricted state.
- Reuse existing UI primitives and formatting helpers; add typed API helpers and an authenticated blob download helper.

Status presentation:

- `FAILED`: red, file-level failure.
- `COMPLETED` with `errorCount > 0`: amber, “Completed with errors”.
- `COMPLETED` with no errors: green, “Valid”.

---

## 9. Testing

**Unit (no database):**
- Parser: quoted fields, escaped quotes, embedded commas/newlines, CRLF, BOM, unclosed quote, header validation, row limit.
- Validation: each rule, decimal precision, arithmetic using decimals, duplicate rows, inactive/joined-date behavior, currency/period consistency, deterministic ordering.
- Export: quoting, formula-injection prefixing, header and row ordering.

**Integration (real PostgreSQL, restricted `paypilot_app` role):**
- RLS select/insert/update behavior for all three tables; cross-tenant reads and writes denied.
- Upload service: valid file, unknown employee, inactive historical employee, duplicate rows, duplicate hash and retry after failure, concurrent identical uploads, rollback leaves no batch/records/findings, row and size limits, audit metadata excludes monetary values.
- HTTP routes with injectable auth: status codes, pagination, filters, manager/employee 403, exception report content type and escaping.

**Verification commands:** `prisma:validate`, `db:status`, API and web typechecks, builds, unit suite, integration suite, and a browser walkthrough of upload, history, detail, filters, download, and the restricted role state.

---

## 10. Delivery

- Branch `feat/payroll-import-validation` from `main`.
- Focused commits: schema/migration; domain parser and validator with unit tests; storage/service/routes with integration tests; web types/client; web pages; docs, purge script, verification notes.
- Draft PR if `gh` is authenticated; otherwise report that and leave the branch unmerged.
- No history rewrites, force pushes, or unrelated staging.
