# Payroll Import & Integrity Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a payroll-register import workflow: authenticated CSV upload, deterministic validation findings, persisted batches/records, history/detail APIs, and exception-report downloads.

**Architecture:** A raw `text/csv` upload route runs inside the existing tenant transaction. A pure parser and rules engine normalize rows, resolve employee numbers through one organization-scoped lookup, and produce deterministic findings; one transaction persists the batch, records, and findings, then the response is sent after commit. New tables carry forced RLS policies. The web app reuses the existing design system and API client.

**Tech Stack:** TypeScript, Express 4, Zod 3, Prisma 5.22, PostgreSQL 16 with RLS, React 18, Vite, Tailwind, Keycloak.

**Spec:** `docs/superpowers/specs/2026-11-07-payroll-import-integrity-design.md`

---

## File Map

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` | Import enums/models and relations |
| `prisma/migrations/20261107090000_payroll_imports/migration.sql` | Tables, indexes, RLS policies |
| `apps/api/src/features/payrollImport/payrollImport.types.ts` | Rule codes, limits, domain types |
| `apps/api/src/features/payrollImport/csv.ts` | RFC 4180 parser |
| `apps/api/src/features/payrollImport/validation.ts` | Header/row normalization and validation engine |
| `apps/api/src/features/payrollImport/export.ts` | Exception-report CSV builder |
| `apps/api/src/features/payrollImport/storage.ts` | Private file storage, hash, filename safety |
| `apps/api/src/features/payrollImport/payrollImport.dto.ts` | API DTO mappers |
| `apps/api/src/features/payrollImport/payrollImport.schema.ts` | Zod query schemas |
| `apps/api/src/features/payrollImport/payrollImport.service.ts` | Tenant-scoped orchestration and queries |
| `apps/api/src/features/payrollImport/payrollImport.routes.ts` | Router factory, raw upload, CSV download |
| `apps/api/src/features/payrollImport/*.test.ts` | Unit and PostgreSQL integration tests |
| `apps/api/src/middleware/auth.ts` | File-response support in `tenantRouteHandler` |
| `apps/api/src/middleware/errorHandler.ts` | Map oversized payloads to 413 |
| `apps/api/src/routes/index.ts` | Mount the router |
| `scripts/purge-payroll-imports.ts` | Expired raw-file purge |
| `apps/web/src/pages/PayrollImportsPage.tsx` | Upload + history |
| `apps/web/src/pages/PayrollImportDetailPage.tsx` | Detail, findings, records, download |
| `apps/web/src/components/payroll/ImportUploadCard.tsx` | File selection and client-side checks |
| `apps/web/src/components/payroll/PayrollImportStatusBadge.tsx` | Shared status badge |
| `apps/web/src/lib/payrollImports.ts` | Typed API helpers |
| `apps/web/src/lib/api.ts` | Raw upload and blob download helpers |
| `apps/web/src/types/index.ts` | Import DTOs |
| `apps/web/src/app/router.tsx` | Routes |
| `apps/web/src/components/layout/Sidebar.tsx` | Navigation item |
| `.env.example`, `.gitignore`, `README.md` | Storage config, retention, format, endpoints |

---

### Task 1: Schema, migration, and RLS

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261107090000_payroll_imports/migration.sql`

- [ ] **Step 1: Add enums and relations**

Append to the enums block:

```prisma
enum PayrollImportStatus {
  PROCESSING
  COMPLETED
  FAILED
}

enum ValidationSeverity {
  ERROR
  WARNING
  INFO
}
```

Add `payrollImportBatches PayrollImportBatch[]` to `Organization`, `payrollImportBatches PayrollImportBatch[] @relation("CreatedPayrollImports")` to `User`, and `payrollImportRecords ImportedPayrollRecord[]` to `Employee`.

Append the models:

```prisma
model PayrollImportBatch {
  id               String              @id @default(uuid())
  organizationId   String              @map("organization_id")
  createdById      String?             @map("created_by_id")
  originalFilename String              @map("original_filename")
  storageKey       String?             @map("storage_key")
  fileHash         String              @map("file_hash")
  fileSizeBytes    Int                 @map("file_size_bytes")
  rulesetVersion   String              @map("ruleset_version")
  status           PayrollImportStatus @default(PROCESSING)
  rowCount         Int                 @default(0) @map("row_count")
  validRowCount    Int                 @default(0) @map("valid_row_count")
  invalidRowCount  Int                 @default(0) @map("invalid_row_count")
  errorCount       Int                 @default(0) @map("error_count")
  warningCount     Int                 @default(0) @map("warning_count")
  infoCount        Int                 @default(0) @map("info_count")
  currency         String?
  payPeriodStart   DateTime?           @map("pay_period_start") @db.Date
  payPeriodEnd     DateTime?           @map("pay_period_end") @db.Date
  retentionUntil   DateTime            @map("retention_until")
  filePurgedAt     DateTime?           @map("file_purged_at")
  createdAt        DateTime            @default(now()) @map("created_at")
  completedAt      DateTime?           @map("completed_at")

  organization Organization             @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  createdBy    User?                    @relation("CreatedPayrollImports", fields: [createdById], references: [id], onDelete: SetNull)
  records      ImportedPayrollRecord[]
  findings     ValidationFinding[]

  @@index([organizationId, createdAt])
  @@index([organizationId, status])
  @@index([organizationId, fileHash])
  @@map("payroll_import_batches")
}

model ImportedPayrollRecord {
  id             String   @id @default(uuid())
  organizationId String   @map("organization_id")
  batchId        String   @map("batch_id")
  employeeId     String?  @map("employee_id")
  employeeNumber String   @map("employee_number")
  rowNumber      Int      @map("row_number")
  payPeriodStart DateTime? @map("pay_period_start") @db.Date
  payPeriodEnd   DateTime? @map("pay_period_end") @db.Date
  currency       String?
  grossPay       Decimal? @map("gross_pay") @db.Decimal(14, 2)
  totalDeductions Decimal? @map("total_deductions") @db.Decimal(14, 2)
  netPay         Decimal? @map("net_pay") @db.Decimal(14, 2)
  isValid        Boolean  @default(false) @map("is_valid")
  createdAt      DateTime @default(now()) @map("created_at")

  organization Organization         @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  batch        PayrollImportBatch   @relation(fields: [batchId], references: [id], onDelete: Cascade)
  employee     Employee?            @relation(fields: [employeeId], references: [id], onDelete: SetNull)
  findings     ValidationFinding[]

  @@index([organizationId, batchId])
  @@index([employeeId])
  @@map("imported_payroll_records")
}

model ValidationFinding {
  id             String             @id @default(uuid())
  organizationId String             @map("organization_id")
  batchId        String             @map("batch_id")
  recordId       String?            @map("record_id")
  rowNumber      Int?               @map("row_number")
  field          String?
  ruleCode       String             @map("rule_code")
  severity       ValidationSeverity
  message        String
  expected       String?
  actual         String?
  createdAt      DateTime           @default(now()) @map("created_at")

  organization Organization           @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  batch        PayrollImportBatch     @relation(fields: [batchId], references: [id], onDelete: Cascade)
  record       ImportedPayrollRecord? @relation(fields: [recordId], references: [id], onDelete: Cascade)

  @@index([organizationId, batchId, severity])
  @@index([batchId, rowNumber])
  @@map("validation_findings")
}
```

- [ ] **Step 2: Generate the migration skeleton**

Run: `npx prisma migrate dev --name payroll_imports --create-only`
Expected: a new migration directory is created and Prisma reports it is ready to apply.

- [ ] **Step 3: Append RLS policies to the generated migration**

```sql
ALTER TABLE public.payroll_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_import_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE public.imported_payroll_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imported_payroll_records FORCE ROW LEVEL SECURITY;
ALTER TABLE public.validation_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.validation_findings FORCE ROW LEVEL SECURITY;

CREATE POLICY payroll_import_batches_app_select ON public.payroll_import_batches
  FOR SELECT TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());
CREATE POLICY payroll_import_batches_app_insert ON public.payroll_import_batches
  FOR INSERT TO paypilot_app
  WITH CHECK (organization_id = public.paypilot_current_organization_id());
CREATE POLICY payroll_import_batches_app_update ON public.payroll_import_batches
  FOR UPDATE TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id())
  WITH CHECK (organization_id = public.paypilot_current_organization_id());

CREATE POLICY imported_payroll_records_app_select ON public.imported_payroll_records
  FOR SELECT TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());
CREATE POLICY imported_payroll_records_app_insert ON public.imported_payroll_records
  FOR INSERT TO paypilot_app
  WITH CHECK (organization_id = public.paypilot_current_organization_id());

CREATE POLICY validation_findings_app_select ON public.validation_findings
  FOR SELECT TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());
CREATE POLICY validation_findings_app_insert ON public.validation_findings
  FOR INSERT TO paypilot_app
  WITH CHECK (organization_id = public.paypilot_current_organization_id());

CREATE POLICY payroll_import_batches_migrator_all ON public.payroll_import_batches
  FOR ALL TO paypilot_migrator USING (true) WITH CHECK (true);
CREATE POLICY imported_payroll_records_migrator_all ON public.imported_payroll_records
  FOR ALL TO paypilot_migrator USING (true) WITH CHECK (true);
CREATE POLICY validation_findings_migrator_all ON public.validation_findings
  FOR ALL TO paypilot_migrator USING (true) WITH CHECK (true);
```

- [ ] **Step 4: Apply and verify**

Run: `npx prisma migrate deploy && npx prisma validate && npm run db:status`
Expected: migration applied, schema valid, database up to date.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add payroll import tables and RLS"
```

---

### Task 2: Domain types and CSV parser

**Files:**
- Create: `apps/api/src/features/payrollImport/payrollImport.types.ts`
- Create: `apps/api/src/features/payrollImport/csv.ts`
- Test: `apps/api/src/features/payrollImport/csv.test.ts`

- [ ] **Step 1: Write the failing parser tests**

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from './csv';

describe('parseCsv', () => {
  it('parses headers and rows', () => {
    const result = parseCsv('a,b\n1,2\n3,4\n');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.headers, ['a', 'b']);
    assert.deepEqual(result.rows, [
      { rowNumber: 1, values: ['1', '2'] },
      { rowNumber: 2, values: ['3', '4'] },
    ]);
  });

  it('strips a BOM and handles CRLF', () => {
    const result = parseCsv('\uFEFFa,b\r\nx,y\r\n');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.headers, ['a', 'b']);
    assert.deepEqual(result.rows[0].values, ['x', 'y']);
  });

  it('keeps commas, quotes, and newlines inside quoted fields', () => {
    const result = parseCsv('a,b\n"one, two","say ""hi""\nnext"\n');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.rows[0].values, ['one, two', 'say "hi"\nnext']);
  });

  it('skips blank lines and trailing newlines', () => {
    const result = parseCsv('a,b\n\n1,2\n\n');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.rows.length, 1);
  });

  it('rejects an unclosed quote', () => {
    const result = parseCsv('a,b\n"1,2\n');
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.message, /quote/i);
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test --workspace=apps/api -- --test-name-pattern=parseCsv`
Expected: FAIL because `./csv` does not exist.

- [ ] **Step 3: Implement types and parser**

`payrollImport.types.ts`:

```ts
import type { EmployeeStatus } from '@prisma/client';

export const RULESET_VERSION = 'payroll-import-rules/v1';
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_DATA_ROWS = 10_000;
export const RETENTION_DAYS = 90;

export const REQUIRED_COLUMNS = [
  'employee_number',
  'pay_period_start',
  'pay_period_end',
  'currency',
  'gross_pay',
  'total_deductions',
  'net_pay',
] as const;

export type RequiredColumn = (typeof REQUIRED_COLUMNS)[number];

export type RuleCode =
  | 'EMPTY_FILE'
  | 'INVALID_HEADER'
  | 'CSV_PARSE_ERROR'
  | 'TOO_MANY_ROWS'
  | 'UNEXPECTED_COLUMN'
  | 'MISSING_VALUE'
  | 'INVALID_DATE'
  | 'INVALID_PERIOD'
  | 'INVALID_CURRENCY'
  | 'INVALID_AMOUNT'
  | 'UNSUPPORTED_PRECISION'
  | 'UNKNOWN_EMPLOYEE'
  | 'NEGATIVE_AMOUNT'
  | 'ARITHMETIC_MISMATCH'
  | 'DUPLICATE_EMPLOYEE_PERIOD'
  | 'INCONSISTENT_CURRENCY'
  | 'INCONSISTENT_PAY_PERIOD'
  | 'EMPLOYEE_INACTIVE'
  | 'PERIOD_BEFORE_JOIN_DATE';

export type Severity = 'ERROR' | 'WARNING' | 'INFO';

export const RULE_SEVERITY: Record<RuleCode, Severity> = {
  EMPTY_FILE: 'ERROR',
  INVALID_HEADER: 'ERROR',
  CSV_PARSE_ERROR: 'ERROR',
  TOO_MANY_ROWS: 'ERROR',
  UNEXPECTED_COLUMN: 'WARNING',
  MISSING_VALUE: 'ERROR',
  INVALID_DATE: 'ERROR',
  INVALID_PERIOD: 'ERROR',
  INVALID_CURRENCY: 'ERROR',
  INVALID_AMOUNT: 'ERROR',
  UNSUPPORTED_PRECISION: 'ERROR',
  UNKNOWN_EMPLOYEE: 'ERROR',
  NEGATIVE_AMOUNT: 'ERROR',
  ARITHMETIC_MISMATCH: 'ERROR',
  DUPLICATE_EMPLOYEE_PERIOD: 'ERROR',
  INCONSISTENT_CURRENCY: 'ERROR',
  INCONSISTENT_PAY_PERIOD: 'ERROR',
  EMPLOYEE_INACTIVE: 'WARNING',
  PERIOD_BEFORE_JOIN_DATE: 'WARNING',
};

export const RULE_ORDER = Object.keys(RULE_SEVERITY) as RuleCode[];

export interface FindingDraft {
  rowNumber?: number;
  field?: string;
  ruleCode: RuleCode;
  message: string;
  expected?: string;
  actual?: string;
}

export interface EmployeeReference {
  id: string;
  employeeNumber: string;
  status: EmployeeStatus;
  joinedAt: string;
}

export interface ParsedRow {
  rowNumber: number;
  values: string[];
}

export interface ParsedRegister {
  columns: Record<RequiredColumn, number>;
  rows: ParsedRow[];
  headerFindings: FindingDraft[];
}

export interface NormalizedRecord {
  rowNumber: number;
  employeeId: string | null;
  employeeNumber: string;
  payPeriodStart: string | null;
  payPeriodEnd: string | null;
  currency: string | null;
  grossPay: string | null;
  totalDeductions: string | null;
  netPay: string | null;
  isValid: boolean;
  findings: FindingDraft[];
}

export interface ValidationResult {
  records: NormalizedRecord[];
  batchFindings: FindingDraft[];
  currency: string | null;
  payPeriodStart: string | null;
  payPeriodEnd: string | null;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  validRowCount: number;
  invalidRowCount: number;
}
```

`csv.ts`:

```ts
export interface CsvRow {
  rowNumber: number;
  values: string[];
}

export type CsvParseResult =
  | { ok: true; headers: string[]; rows: CsvRow[] }
  | { ok: false; message: string; rowNumber?: number };

export function parseCsv(input: string): CsvParseResult {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldStart = true;
  let line = 1;
  let recordStartLine = 1;

  const pushRecord = () => {
    record.push(field);
    const onlyEmpty = record.length === 1 && record[0] === '';
    if (!onlyEmpty) {
      records.push(record);
    }
    record = [];
    field = '';
    fieldStart = true;
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
          fieldStart = false;
        }
      } else {
        if (char === '\n') line += 1;
        field += char;
      }
      continue;
    }

    if (char === '"' && fieldStart) {
      inQuotes = true;
      fieldStart = false;
      continue;
    }

    if (char === ',') {
      record.push(field);
      field = '';
      fieldStart = true;
      continue;
    }

    if (char === '\n') {
      pushRecord();
      line += 1;
      recordStartLine = line;
      continue;
    }

    if (char === '\r') {
      if (text[i + 1] === '\n') {
        i += 1;
      }
      pushRecord();
      line += 1;
      recordStartLine = line;
      continue;
    }

    field += char;
    fieldStart = false;
  }

  if (inQuotes) {
    return {
      ok: false,
      message: 'Unclosed quoted field in CSV input',
      rowNumber: recordStartLine,
    };
  }

  if (field !== '' || record.length > 0) {
    pushRecord();
  }

  const [headers = [], ...rows] = records;

  return {
    ok: true,
    headers,
    rows: rows.map((values, index) => ({ rowNumber: index + 1, values })),
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test --workspace=apps/api -- --test-name-pattern=parseCsv`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/features/payrollImport
git commit -m "feat(api): add payroll CSV parser and domain types"
```

---

### Task 3: Deterministic validation engine

**Files:**
- Create: `apps/api/src/features/payrollImport/validation.ts`
- Test: `apps/api/src/features/payrollImport/validation.test.ts`

- [ ] **Step 1: Write failing tests for structural and integrity rules**

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EmployeeStatus } from '@prisma/client';
import {
  parseDateOnly,
  parseMoney,
  parsePayrollRegister,
  validateParsedRegister,
} from './validation';
import type { EmployeeReference } from './payrollImport.types';

const header =
  'employee_number,pay_period_start,pay_period_end,currency,gross_pay,total_deductions,net_pay';
const row = (
  employee = 'PP-1001',
  start = '2026-10-01',
  end = '2026-10-31',
  currency = 'INR',
  gross = '75000.00',
  deductions = '12500.00',
  net = '62500.00'
) => `${employee},${start},${end},${currency},${gross},${deductions},${net}`;

const employees = new Map<string, EmployeeReference>([
  [
    'PP-1001',
    {
      id: '11111111-1111-4111-8111-111111111111',
      employeeNumber: 'PP-1001',
      status: EmployeeStatus.ACTIVE,
      joinedAt: '2025-01-01',
    },
  ],
  [
    'PP-1002',
    {
      id: '22222222-2222-4222-8222-222222222222',
      employeeNumber: 'PP-1002',
      status: EmployeeStatus.TERMINATED,
      joinedAt: '2020-01-01',
    },
  ],
]);

function validate(lines: string[]) {
  const parsed = parsePayrollRegister([header, ...lines].join('\n'));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error('parse failed');
  return validateParsedRegister(parsed.register, employees);
}

const codes = (findings: { ruleCode: string }[]) => findings.map((f) => f.ruleCode);

describe('parseDateOnly', () => {
  it('accepts real ISO dates only', () => {
    assert.equal(parseDateOnly('2026-10-31'), '2026-10-31');
    assert.equal(parseDateOnly('2026-02-30'), null);
    assert.equal(parseDateOnly('31-10-2026'), null);
  });
});

describe('parseMoney', () => {
  it('parses two-decimal money exactly', () => {
    assert.deepEqual(parseMoney('75000.00'), { ok: true, amount: '75000.00', cents: 7500000n });
    assert.deepEqual(parseMoney('0.5'), { ok: true, amount: '0.50', cents: 50n });
    assert.deepEqual(parseMoney('-12.34'), { ok: true, amount: '-12.34', cents: -1234n });
  });

  it('distinguishes precision from invalid input', () => {
    assert.deepEqual(parseMoney('1.234'), { ok: false, reason: 'PRECISION' });
    assert.deepEqual(parseMoney('abc'), { ok: false, reason: 'INVALID' });
    assert.deepEqual(parseMoney('  '), { ok: false, reason: 'MISSING' });
  });
});

describe('validateParsedRegister', () => {
  it('accepts a valid register and resolves the employee', () => {
    const result = validate([row()]);
    assert.equal(result.errorCount, 0);
    assert.equal(result.validRowCount, 1);
    assert.equal(result.records[0].employeeId, employees.get('PP-1001')!.id);
    assert.equal(result.records[0].currency, 'INR');
  });

  it('flags arithmetic mismatches', () => {
    const result = validate([row(undefined, undefined, undefined, undefined, '75000.00', '12500.00', '63000.00')]);
    assert.deepEqual(codes(result.records[0].findings), ['ARITHMETIC_MISMATCH']);
    assert.equal(result.records[0].isValid, false);
    assert.equal(result.records[0].findings[0].expected, '62500.00');
    assert.equal(result.records[0].findings[0].actual, '63000.00');
  });

  it('flags negative amounts and unsupported precision', () => {
    const result = validate([row(undefined, undefined, undefined, undefined, '-1.00', '0.00', '-1.00')]);
    assert.deepEqual(codes(result.records[0].findings), ['NEGATIVE_AMOUNT', 'NEGATIVE_AMOUNT']);
    const precision = validate([row(undefined, undefined, undefined, undefined, '1.234', '0.00', '1.23')]);
    assert.ok(codes(precision.records[0].findings).includes('UNSUPPORTED_PRECISION'));
  });

  it('flags unknown employees and never rejects inactive employees automatically', () => {
    const unknown = validate([row('PP-9999')]);
    assert.deepEqual(codes(unknown.records[0].findings), ['UNKNOWN_EMPLOYEE']);
    const inactive = validate([row('PP-1002', '2026-10-01', '2026-10-31')]);
    assert.deepEqual(codes(inactive.records[0].findings), ['EMPLOYEE_INACTIVE']);
    assert.equal(inactive.records[0].isValid, true);
    assert.equal(inactive.errorCount, 0);
  });

  it('warns when the period starts before joining', () => {
    const result = validate([row('PP-1001', '2024-12-01', '2024-12-31')]);
    assert.deepEqual(codes(result.records[0].findings), ['PERIOD_BEFORE_JOIN_DATE']);
    assert.equal(result.records[0].isValid, true);
  });

  it('detects duplicate employee periods', () => {
    const result = validate([row(), row()]);
    assert.deepEqual(codes(result.records[1].findings), ['DUPLICATE_EMPLOYEE_PERIOD']);
    assert.equal(result.validRowCount, 1);
    assert.equal(result.invalidRowCount, 1);
  });

  it('flags mixed currencies and periods after the first row', () => {
    const result = validate([
      row(),
      row('PP-1002', '2026-10-01', '2026-10-31', 'USD', '1.00', '0.00', '1.00'),
      row('PP-1002', '2026-11-01', '2026-11-30', 'INR', '1.00', '0.00', '1.00'),
    ]);
    assert.ok(codes(result.records[1].findings).includes('INCONSISTENT_CURRENCY'));
    assert.ok(codes(result.records[2].findings).includes('INCONSISTENT_PAY_PERIOD'));
  });

  it('reports file-level failures', () => {
    const empty = parsePayrollRegister('');
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.deepEqual(codes(empty.findings), ['EMPTY_FILE']);

    const missing = parsePayrollRegister('employee_number,currency\nPP-1001,INR');
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.deepEqual(codes(missing.findings), ['INVALID_HEADER']);

    const duplicateHeader = parsePayrollRegister(`${header},net_pay\n${row()},62500.00`);
    assert.equal(duplicateHeader.ok, false);
    if (!duplicateHeader.ok) assert.deepEqual(codes(duplicateHeader.findings), ['INVALID_HEADER']);
  });

  it('is deterministic', () => {
    const first = validate([row(), row('PP-9999')]);
    const second = validate([row(), row('PP-9999')]);
    assert.deepEqual(first, second);
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test --workspace=apps/api -- --test-name-pattern=validateParsedRegister`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the engine**

```ts
import { parseCsv } from './csv';
import {
  MAX_DATA_ROWS,
  REQUIRED_COLUMNS,
  RULE_ORDER,
  RULE_SEVERITY,
  type EmployeeReference,
  type FindingDraft,
  type NormalizedRecord,
  type ParsedRegister,
  type RequiredColumn,
  type RuleCode,
  type ValidationResult,
} from './payrollImport.types';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;
const MONEY = /^-?\d{1,12}(?:\.\d{1,2})?$/;
const MONEY_PRECISION = /^-?\d{1,12}\.\d{3,}$/;

export type RegisterParseResult =
  | { ok: true; register: ParsedRegister }
  | { ok: false; findings: FindingDraft[] };

export function parseDateOnly(value: string): string | null {
  if (!ISO_DATE.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10) === value ? value : null;
}

export type MoneyResult =
  | { ok: true; amount: string; cents: bigint }
  | { ok: false; reason: 'MISSING' | 'PRECISION' | 'INVALID' };

export function formatCents(cents: bigint): string {
  const absolute = cents < 0n ? -cents : cents;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  return `${cents < 0n ? '-' : ''}${whole}.${fraction}`;
}

export function parseMoney(value: string): MoneyResult {
  const trimmed = value.trim();
  if (trimmed === '') return { ok: false, reason: 'MISSING' };
  if (MONEY_PRECISION.test(trimmed)) return { ok: false, reason: 'PRECISION' };
  if (!MONEY.test(trimmed)) return { ok: false, reason: 'INVALID' };

  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole, fraction = ''] = unsigned.split('.');
  const cents = BigInt(whole + fraction.padEnd(2, '0')) * (negative ? -1n : 1n);
  return { ok: true, amount: formatCents(cents), cents };
}

function finding(
  ruleCode: RuleCode,
  message: string,
  details: Omit<FindingDraft, 'ruleCode' | 'message'> = {}
): FindingDraft {
  return { ruleCode, message, ...details };
}

function sortFindings(findings: FindingDraft[]): FindingDraft[] {
  return [...findings].sort((a, b) => {
    const rule = RULE_ORDER.indexOf(a.ruleCode) - RULE_ORDER.indexOf(b.ruleCode);
    if (rule !== 0) return rule;
    return (a.field ?? '').localeCompare(b.field ?? '');
  });
}

function resolveColumns(headers: string[]):
  | { ok: true; columns: Record<RequiredColumn, number>; findings: FindingDraft[] }
  | { ok: false; findings: FindingDraft[] } {
  const normalized = headers.map((header) => header.trim());
  const duplicates = normalized.filter(
    (header, index) =>
      header !== '' && normalized.indexOf(header) !== index
  );

  if (duplicates.length > 0) {
    return {
      ok: false,
      findings: [
        finding('INVALID_HEADER', `Duplicate column headers: ${[...new Set(duplicates)].join(', ')}`, {
          expected: 'Each required column appears once',
          actual: [...new Set(duplicates)].join(','),
        }),
      ],
    };
  }

  const columns = {} as Record<RequiredColumn, number>;
  const missing: string[] = [];

  for (const column of REQUIRED_COLUMNS) {
    const index = normalized.indexOf(column);
    if (index === -1) missing.push(column);
    else columns[column] = index;
  }

  if (missing.length > 0) {
    return {
      ok: false,
      findings: [
        finding('INVALID_HEADER', `Missing required columns: ${missing.join(', ')}`, {
          expected: REQUIRED_COLUMNS.join(','),
          actual: missing.join(','),
        }),
      ],
    };
  }

  const extras = normalized.filter(
    (header) => header !== '' && !(REQUIRED_COLUMNS as readonly string[]).includes(header)
  );
  const findings = extras.length
    ? [
        finding('UNEXPECTED_COLUMN', `Ignoring unexpected columns: ${extras.join(', ')}`, {
          expected: REQUIRED_COLUMNS.join(','),
          actual: extras.join(','),
        }),
      ]
    : [];

  return { ok: true, columns, findings };
}

export function parsePayrollRegister(text: string): RegisterParseResult {
  if (text.trim() === '') {
    return { ok: false, findings: [finding('EMPTY_FILE', 'The uploaded file is empty.')] };
  }

  const parsed = parseCsv(text);
  if (!parsed.ok) {
    return {
      ok: false,
      findings: [
        finding('CSV_PARSE_ERROR', parsed.message, { rowNumber: parsed.rowNumber }),
      ],
    };
  }

  const resolved = resolveColumns(parsed.headers);
  if (!resolved.ok) return { ok: false, findings: resolved.findings };

  if (parsed.rows.length === 0) {
    return {
      ok: false,
      findings: [
        ...resolved.findings,
        finding('EMPTY_FILE', 'The file contains a header but no data rows.'),
      ],
    };
  }

  if (parsed.rows.length > MAX_DATA_ROWS) {
    return {
      ok: false,
      findings: [
        ...resolved.findings,
        finding(
          'TOO_MANY_ROWS',
          `The file contains ${parsed.rows.length} data rows; the limit is ${MAX_DATA_ROWS}.`,
          { expected: String(MAX_DATA_ROWS), actual: String(parsed.rows.length) }
        ),
      ],
    };
  }

  return {
    ok: true,
    register: { columns: resolved.columns, rows: parsed.rows, headerFindings: resolved.findings },
  };
}

export function validateParsedRegister(
  register: ParsedRegister,
  employees: ReadonlyMap<string, EmployeeReference>
): ValidationResult {
  const records: NormalizedRecord[] = [];
  const batchFindings = [...register.headerFindings];
  const seenPeriods = new Set<string>();
  let batchCurrency: string | null = null;
  let batchStart: string | null = null;
  let batchEnd: string | null = null;

  for (const row of register.rows) {
    const findings: FindingDraft[] = [];
    const get = (column: RequiredColumn) =>
      (row.values[register.columns[column]] ?? '').trim();

    const employeeNumber = get('employee_number').toUpperCase();
    if (!employeeNumber) {
      findings.push(finding('MISSING_VALUE', 'Employee number is required.', { field: 'employee_number' }));
    }

    const startValue = get('pay_period_start');
    const endValue = get('pay_period_end');
    const start = startValue ? parseDateOnly(startValue) : null;
    const end = endValue ? parseDateOnly(endValue) : null;

    if (!startValue) {
      findings.push(finding('MISSING_VALUE', 'Pay period start is required.', { field: 'pay_period_start' }));
    } else if (!start) {
      findings.push(
        finding('INVALID_DATE', 'Pay period start is not a valid ISO date.', {
          field: 'pay_period_start',
          expected: 'YYYY-MM-DD',
          actual: startValue,
        })
      );
    }

    if (!endValue) {
      findings.push(finding('MISSING_VALUE', 'Pay period end is required.', { field: 'pay_period_end' }));
    } else if (!end) {
      findings.push(
        finding('INVALID_DATE', 'Pay period end is not a valid ISO date.', {
          field: 'pay_period_end',
          expected: 'YYYY-MM-DD',
          actual: endValue,
        })
      );
    }

    if (start && end && start > end) {
      findings.push(
        finding('INVALID_PERIOD', 'Pay period start must not be after the end.', {
          expected: `<= ${end}`,
          actual: start,
        })
      );
    }

    const currencyValue = get('currency');
    let currency: string | null = null;
    if (!currencyValue) {
      findings.push(finding('MISSING_VALUE', 'Currency is required.', { field: 'currency' }));
    } else if (!CURRENCY.test(currencyValue)) {
      findings.push(
        finding('INVALID_CURRENCY', 'Currency must be a three-letter uppercase code.', {
          field: 'currency',
          expected: 'AAA',
          actual: currencyValue,
        })
      );
    } else {
      currency = currencyValue;
      if (batchCurrency === null) batchCurrency = currencyValue;
      else if (batchCurrency !== currencyValue) {
        findings.push(
          finding('INCONSISTENT_CURRENCY', 'All rows in a batch must use the same currency.', {
            field: 'currency',
            expected: batchCurrency,
            actual: currencyValue,
          })
        );
      }
    }

    const moneyColumns = ['gross_pay', 'total_deductions', 'net_pay'] as const;
    const amounts: Partial<Record<(typeof moneyColumns)[number], { amount: string; cents: bigint }>> = {};

    for (const column of moneyColumns) {
      const raw = get(column);
      if (!raw) {
        findings.push(finding('MISSING_VALUE', `${column} is required.`, { field: column }));
        continue;
      }

      const parsed = parseMoney(raw);
      if (!parsed.ok) {
        if (parsed.reason === 'PRECISION') {
          findings.push(
            finding('UNSUPPORTED_PRECISION', 'Monetary values support at most two decimals.', {
              field: column,
              expected: '0.00',
              actual: raw,
            })
          );
        } else {
          findings.push(
            finding('INVALID_AMOUNT', 'Monetary value is not a valid decimal amount.', {
              field: column,
              expected: '0.00',
              actual: raw,
            })
          );
        }
        continue;
      }

      amounts[column] = { amount: parsed.amount, cents: parsed.cents };
      if (parsed.cents < 0n) {
        findings.push(
          finding('NEGATIVE_AMOUNT', 'Monetary values cannot be negative.', {
            field: column,
            expected: '>= 0.00',
            actual: parsed.amount,
          })
        );
      }
    }

    if (start && end) {
      if (batchStart === null) {
        batchStart = start;
        batchEnd = end;
      } else if (batchStart !== start || batchEnd !== end) {
        findings.push(
          finding('INCONSISTENT_PAY_PERIOD', 'All rows in a batch must use the same pay period.', {
            expected: `${batchStart}..${batchEnd}`,
            actual: `${start}..${end}`,
          })
        );
      }
    }

    let employeeId: string | null = null;
    if (employeeNumber) {
      const employee = employees.get(employeeNumber);
      if (!employee) {
        findings.push(
          finding('UNKNOWN_EMPLOYEE', 'Employee number was not found in this organization.', {
            field: 'employee_number',
            actual: employeeNumber,
          })
        );
      } else {
        employeeId = employee.id;
        if (employee.status !== 'ACTIVE') {
          findings.push(
            finding('EMPLOYEE_INACTIVE', 'Employee is not currently active; historical payroll may still be valid.', {
              field: 'employee_number',
              actual: employee.status,
            })
          );
        }
        if (start && start < employee.joinedAt) {
          findings.push(
            finding('PERIOD_BEFORE_JOIN_DATE', 'Pay period starts before the employee joined.', {
              expected: `>= ${employee.joinedAt}`,
              actual: start,
            })
          );
        }
      }
    }

    if (employeeNumber && start && end) {
      const key = `${employeeNumber}|${start}|${end}`;
      if (seenPeriods.has(key)) {
        findings.push(
          finding('DUPLICATE_EMPLOYEE_PERIOD', 'Employee appears more than once for the same pay period.', {
            actual: `${employeeNumber} ${start}..${end}`,
          })
        );
      } else {
        seenPeriods.add(key);
      }
    }

    const gross = amounts.gross_pay;
    const deductions = amounts.total_deductions;
    const net = amounts.net_pay;
    if (gross && deductions && net) {
      const expected = gross.cents - deductions.cents;
      if (expected !== net.cents) {
        findings.push(
          finding('ARITHMETIC_MISMATCH', 'gross_pay minus total_deductions does not equal net_pay.', {
            expected: formatCents(expected),
            actual: net.amount,
          })
        );
      }
    }

    records.push({
      rowNumber: row.rowNumber,
      employeeId,
      employeeNumber,
      payPeriodStart: start,
      payPeriodEnd: end,
      currency,
      grossPay: gross?.amount ?? null,
      totalDeductions: deductions?.amount ?? null,
      netPay: net?.amount ?? null,
      isValid: !findings.some((entry) => RULE_SEVERITY[entry.ruleCode] === 'ERROR'),
      findings: sortFindings(findings),
    });
  }

  const allFindings = [
    ...batchFindings,
    ...records.flatMap((record) => record.findings),
  ];
  const count = (severity: string) =>
    allFindings.filter((entry) => RULE_SEVERITY[entry.ruleCode] === severity).length;

  return {
    records,
    batchFindings: sortFindings(batchFindings),
    currency: batchCurrency,
    payPeriodStart: batchStart,
    payPeriodEnd: batchEnd,
    errorCount: count('ERROR'),
    warningCount: count('WARNING'),
    infoCount: count('INFO'),
    validRowCount: records.filter((record) => record.isValid).length,
    invalidRowCount: records.filter((record) => !record.isValid).length,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test --workspace=apps/api -- --test-name-pattern=validateParsedRegister`
Expected: PASS. Also run `npm run typecheck --workspace=apps/api`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/features/payrollImport
git commit -m "feat(api): add deterministic payroll validation engine"
```

---

### Task 4: Exception-report CSV builder

**Files:**
- Create: `apps/api/src/features/payrollImport/export.ts`
- Test: `apps/api/src/features/payrollImport/export.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildExceptionReportCsv, safeCsvCell } from './export';

describe('exception report CSV', () => {
  it('quotes fields and escapes quotes and commas', () => {
    assert.equal(safeCsvCell('say "hi", ok'), '"say ""hi"", ok"');
  });

  it('prefixes dangerous formula cells', () => {
    assert.equal(safeCsvCell('=SUM(A1)'), "\"'=SUM(A1)\"");
    assert.equal(safeCsvCell('+1'), "\"'+1\"");
    assert.equal(safeCsvCell('-1'), "\"'-1\"");
    assert.equal(safeCsvCell('@cmd'), "\"'@cmd\"");
  });

  it('builds a deterministic report with a header', () => {
    const csv = buildExceptionReportCsv([
      {
        rowNumber: 1,
        employeeNumber: 'PP-1001',
        payPeriodStart: '2026-10-01',
        payPeriodEnd: '2026-10-31',
        currency: 'INR',
        grossPay: '75000.00',
        totalDeductions: '12500.00',
        netPay: '63000.00',
        severity: 'ERROR',
        ruleCode: 'ARITHMETIC_MISMATCH',
        field: '',
        message: 'gross_pay minus total_deductions does not equal net_pay.',
        expected: '62500.00',
        actual: '63000.00',
      },
    ]);
    const lines = csv.split('\r\n');
    assert.match(lines[0], /^"row_number"/);
    assert.match(lines[1], /PP-1001/);
    assert.match(lines[1], /ARITHMETIC_MISMATCH/);
    assert.equal(lines.at(-1), '');
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test --workspace=apps/api -- --test-name-pattern="exception report CSV"`
Expected: FAIL because `./export` does not exist.

- [ ] **Step 3: Implement the builder**

```ts
export interface ExceptionReportRow {
  rowNumber: number | null;
  employeeNumber: string | null;
  payPeriodStart: string | null;
  payPeriodEnd: string | null;
  currency: string | null;
  grossPay: string | null;
  totalDeductions: string | null;
  netPay: string | null;
  severity: string;
  ruleCode: string;
  field: string | null;
  message: string;
  expected: string | null;
  actual: string | null;
}

const HEADERS = [
  'row_number',
  'employee_number',
  'pay_period_start',
  'pay_period_end',
  'currency',
  'gross_pay',
  'total_deductions',
  'net_pay',
  'severity',
  'rule_code',
  'field',
  'message',
  'expected',
  'actual',
] as const;

export function safeCsvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function buildExceptionReportCsv(rows: readonly ExceptionReportRow[]): string {
  const lines = [HEADERS.map(safeCsvCell).join(',')];

  for (const row of rows) {
    lines.push(
      [
        row.rowNumber,
        row.employeeNumber,
        row.payPeriodStart,
        row.payPeriodEnd,
        row.currency,
        row.grossPay,
        row.totalDeductions,
        row.netPay,
        row.severity,
        row.ruleCode,
        row.field,
        row.message,
        row.expected,
        row.actual,
      ]
        .map(safeCsvCell)
        .join(',')
    );
  }

  return `${lines.join('\r\n')}\r\n`;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test --workspace=apps/api -- --test-name-pattern="exception report CSV"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/features/payrollImport
git commit -m "feat(api): add safe exception report export"
```

---

### Task 5: Private file storage

**Files:**
- Create: `apps/api/src/features/payrollImport/storage.ts`
- Test: `apps/api/src/features/payrollImport/storage.test.ts`
- Modify: `.gitignore`, `.env.example`

- [ ] **Step 1: Write failing storage tests**

```ts
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildStorageKey,
  deleteImportFile,
  hashBuffer,
  importStorageRoot,
  resolveImportPath,
  sanitizeFilename,
  saveImportFile,
} from './storage';

let root: string;

before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'payroll-import-'));
  process.env.PAYROLL_IMPORT_STORAGE_DIR = root;
});

after(async () => {
  delete process.env.PAYROLL_IMPORT_STORAGE_DIR;
  await rm(root, { recursive: true, force: true });
});

describe('payroll import storage', () => {
  it('hashes bytes deterministically', () => {
    assert.equal(hashBuffer(Buffer.from('x')), hashBuffer(Buffer.from('x')));
    assert.notEqual(hashBuffer(Buffer.from('x')), hashBuffer(Buffer.from('y')));
    assert.equal(hashBuffer(Buffer.from('x')).length, 64);
  });

  it('sanitizes client filenames', () => {
    assert.equal(sanitizeFilename('../../etc/passwd'), 'passwd');
    assert.equal(sanitizeFilename(''), 'payroll.csv');
    assert.ok(sanitizeFilename('a'.repeat(400)).length <= 255);
  });

  it('saves and deletes a private file under the generated key', async () => {
    const key = buildStorageKey('11111111-1111-4111-8111-111111111111', 'batch-1');
    assert.equal(key, '11111111-1111-4111-8111-111111111111/batch-1.csv');
    const saved = await saveImportFile({
      organizationId: '11111111-1111-4111-8111-111111111111',
      batchId: 'batch-1',
      buffer: Buffer.from('hello'),
    });
    assert.equal(await readFile(saved.absolutePath, 'utf8'), 'hello');
    assert.equal(resolveImportPath(key).startsWith(importStorageRoot()), true);
    await deleteImportFile(key);
    await assert.rejects(readFile(saved.absolutePath, 'utf8'));
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test --workspace=apps/api -- --test-name-pattern="payroll import storage"`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement storage**

```ts
import { createHash } from 'node:crypto';
import { chmod, mkdir, unlink, writeFile } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_RELATIVE = path.join('var', 'payroll-imports');

export function importStorageRoot(): string {
  const configured = process.env.PAYROLL_IMPORT_STORAGE_DIR?.trim();
  if (configured) return path.resolve(configured);

  const cwd = process.cwd();
  const repoRoot = fs.existsSync(path.join(cwd, '..', '..', 'package.json'))
    ? path.resolve(cwd, '..', '..')
    : cwd;
  return path.join(repoRoot, DEFAULT_RELATIVE);
}

export function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function sanitizeFilename(value: string | undefined): string {
  const base = path.basename((value ?? '').trim() || 'payroll.csv');
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/]/g, '_').trim();
  return (cleaned || 'payroll.csv').slice(0, 255);
}

export function buildStorageKey(organizationId: string, batchId: string): string {
  return `${organizationId}/${batchId}.csv`;
}

export function resolveImportPath(storageKey: string): string {
  const root = importStorageRoot();
  const full = path.resolve(root, storageKey);
  if (full !== root && !full.startsWith(`${root}${path.sep}`)) {
    throw new Error('Invalid storage key');
  }
  return full;
}

export async function saveImportFile(input: {
  organizationId: string;
  batchId: string;
  buffer: Buffer;
}): Promise<{ storageKey: string; absolutePath: string }> {
  const storageKey = buildStorageKey(input.organizationId, input.batchId);
  const absolutePath = resolveImportPath(storageKey);
  const directory = path.dirname(absolutePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(absolutePath, input.buffer, { mode: 0o600 });
  await chmod(absolutePath, 0o600);
  return { storageKey, absolutePath };
}

export async function deleteImportFile(storageKey: string): Promise<void> {
  await unlink(resolveImportPath(storageKey));
}

export async function deleteImportFileQuietly(storageKey: string): Promise<void> {
  try {
    await deleteImportFile(storageKey);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
```

- [ ] **Step 4: Update configuration files**

Add to `.gitignore`:

```gitignore
# Private payroll import storage
var/
```

Add to `.env.example` under Backend API Configuration:

```bash
# Optional. Defaults to <repo>/var/payroll-imports. Must be private and writable.
# PAYROLL_IMPORT_STORAGE_DIR=/absolute/path/to/payroll-imports
```

- [ ] **Step 5: Run tests**

Run: `npm test --workspace=apps/api -- --test-name-pattern="payroll import storage"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/features/payrollImport .gitignore .env.example
git commit -m "feat(api): add private payroll import storage"
```

---

### Task 6: DTOs, query schemas, and tenant-scoped service

**Files:**
- Create: `apps/api/src/features/payrollImport/payrollImport.dto.ts`
- Create: `apps/api/src/features/payrollImport/payrollImport.schema.ts`
- Create: `apps/api/src/features/payrollImport/payrollImport.service.ts`

- [ ] **Step 1: Add DTO mappers**

```ts
import { Prisma } from '@prisma/client';

export type BatchWithCreator = Prisma.PayrollImportBatchGetPayload<{
  include: { createdBy: { select: { id: true; email: true } } };
}>;

export type RecordWithEmployee = Prisma.ImportedPayrollRecordGetPayload<{
  include: { employee: { select: { firstName: true; lastName: true } } };
}>;

export type FindingWithRecord = Prisma.ValidationFindingGetPayload<{
  include: { record: true };
}>;

export interface PayrollImportBatchDto {
  id: string;
  originalFilename: string;
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
  rulesetVersion: string;
  rowCount: number;
  validRowCount: number;
  invalidRowCount: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  currency: string | null;
  payPeriodStart: string | null;
  payPeriodEnd: string | null;
  fileSizeBytes: number;
  retentionUntil: string;
  filePurgedAt: string | null;
  createdAt: string;
  completedAt: string | null;
  createdBy: { id: string; email: string } | null;
}

export function toBatchDto(batch: BatchWithCreator): PayrollImportBatchDto {
  return {
    id: batch.id,
    originalFilename: batch.originalFilename,
    status: batch.status,
    rulesetVersion: batch.rulesetVersion,
    rowCount: batch.rowCount,
    validRowCount: batch.validRowCount,
    invalidRowCount: batch.invalidRowCount,
    errorCount: batch.errorCount,
    warningCount: batch.warningCount,
    infoCount: batch.infoCount,
    currency: batch.currency,
    payPeriodStart: batch.payPeriodStart?.toISOString().slice(0, 10) ?? null,
    payPeriodEnd: batch.payPeriodEnd?.toISOString().slice(0, 10) ?? null,
    fileSizeBytes: batch.fileSizeBytes,
    retentionUntil: batch.retentionUntil.toISOString(),
    filePurgedAt: batch.filePurgedAt?.toISOString() ?? null,
    createdAt: batch.createdAt.toISOString(),
    completedAt: batch.completedAt?.toISOString() ?? null,
    createdBy: batch.createdBy,
  };
}

export interface ImportedRecordDto {
  id: string;
  rowNumber: number;
  employeeId: string | null;
  employeeNumber: string;
  employeeName: string | null;
  payPeriodStart: string | null;
  payPeriodEnd: string | null;
  currency: string | null;
  grossPay: string | null;
  totalDeductions: string | null;
  netPay: string | null;
  isValid: boolean;
}

export function toRecordDto(record: RecordWithEmployee): ImportedRecordDto {
  return {
    id: record.id,
    rowNumber: record.rowNumber,
    employeeId: record.employeeId,
    employeeNumber: record.employeeNumber,
    employeeName: record.employee
      ? `${record.employee.firstName} ${record.employee.lastName}`
      : null,
    payPeriodStart: record.payPeriodStart?.toISOString().slice(0, 10) ?? null,
    payPeriodEnd: record.payPeriodEnd?.toISOString().slice(0, 10) ?? null,
    currency: record.currency,
    grossPay: record.grossPay?.toFixed(2) ?? null,
    totalDeductions: record.totalDeductions?.toFixed(2) ?? null,
    netPay: record.netPay?.toFixed(2) ?? null,
    isValid: record.isValid,
  };
}

export interface FindingDto {
  id: string;
  rowNumber: number | null;
  field: string | null;
  ruleCode: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  message: string;
  expected: string | null;
  actual: string | null;
}

export function toFindingDto(finding: FindingWithRecord | Prisma.ValidationFindingGetPayload<{}>): FindingDto {
  return {
    id: finding.id,
    rowNumber: finding.rowNumber,
    field: finding.field,
    ruleCode: finding.ruleCode,
    severity: finding.severity,
    message: finding.message,
    expected: finding.expected,
    actual: finding.actual,
  };
}
```

- [ ] **Step 2: Add query schemas**

```ts
import { z } from 'zod';
import { PayrollImportStatus, ValidationSeverity } from '@prisma/client';

const pageSchema = z.coerce
  .number()
  .int()
  .catch(1)
  .transform((value) => Math.min(10_000, Math.max(1, value)));

const pageSizeSchema = z.coerce
  .number()
  .int()
  .catch(25)
  .transform((value) => Math.min(100, Math.max(1, value)));

export const payrollImportListQuerySchema = z.object({
  page: pageSchema,
  pageSize: pageSizeSchema,
  status: z.nativeEnum(PayrollImportStatus).optional(),
});

export const importedRecordListQuerySchema = z.object({
  page: pageSchema,
  pageSize: pageSizeSchema,
  valid: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export const findingListQuerySchema = z.object({
  page: pageSchema,
  pageSize: pageSizeSchema,
  severity: z.nativeEnum(ValidationSeverity).optional(),
  ruleCode: z.string().trim().max(64).optional(),
});

export const payrollImportIdSchema = z.string().uuid();

export type PayrollImportListQuery = z.infer<typeof payrollImportListQuerySchema>;
export type ImportedRecordListQuery = z.infer<typeof importedRecordListQuerySchema>;
export type FindingListQuery = z.infer<typeof findingListQuerySchema>;
```

- [ ] **Step 3: Implement the service**

The service must expose:

```ts
import { Prisma, PayrollImportStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { HttpError } from '../../lib/httpError';
import { parsePayrollRegister, validateParsedRegister } from './validation';
import { buildStorageKey, deleteImportFileQuietly, hashBuffer, sanitizeFilename, saveImportFile } from './storage';
import { RETENTION_DAYS, RULESET_VERSION, RULE_SEVERITY, type EmployeeReference, type FindingDraft } from './payrollImport.types';
import { toBatchDto, toFindingDto, toRecordDto, type BatchWithCreator, type FindingWithRecord, type RecordWithEmployee } from './payrollImport.dto';
import type { FindingListQuery, ImportedRecordListQuery, PayrollImportListQuery } from './payrollImport.schema';

type Tx = Prisma.TransactionClient;
const CREATOR_INCLUDE = { createdBy: { select: { id: true, email: true } } } as const;

export async function importPayrollCsv(tx: Tx, input: {
  organizationId: string;
  userId: string;
  filename: string | undefined;
  buffer: Buffer;
}) {
  const fileHash = hashBuffer(input.buffer);
  const filename = sanitizeFilename(input.filename);
  const batchId = randomUUID();
  const storageKey = buildStorageKey(input.organizationId, batchId);

  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${input.organizationId}::text),
      hashtext(${`payroll_import:${fileHash}`}::text)
    )
  `;

  const duplicate = await tx.payrollImportBatch.findFirst({
    where: { organizationId: input.organizationId, fileHash, status: PayrollImportStatus.COMPLETED },
    select: { id: true },
  });
  if (duplicate) {
    throw new HttpError(409, 'DUPLICATE_IMPORT', 'This payroll file has already been imported.', [
      { path: 'file', message: `Existing batch: ${duplicate.id}` },
    ]);
  }

  await saveImportFile({ organizationId: input.organizationId, batchId, buffer: input.buffer });

  try {
    const parsed = parsePayrollRegister(input.buffer.toString('utf8'));
    let batchFindings: FindingDraft[] = [];
    let records: Array<ReturnType<typeof validateParsedRegister>['records'][number] & { id: string }> = [];
    let currency: string | null = null;
    let payPeriodStart: string | null = null;
    let payPeriodEnd: string | null = null;
    let errorCount = 0;
    let warningCount = 0;
    let infoCount = 0;
    let validRowCount = 0;
    let invalidRowCount = 0;
    let status: PayrollImportStatus = PayrollImportStatus.COMPLETED;

    if (!parsed.ok) {
      batchFindings = parsed.findings;
      status = PayrollImportStatus.FAILED;
      errorCount = parsed.findings.filter((entry) => RULE_SEVERITY[entry.ruleCode] === 'ERROR').length;
      warningCount = parsed.findings.filter((entry) => RULE_SEVERITY[entry.ruleCode] === 'WARNING').length;
    } else {
      const numbers = [...new Set(
        parsed.register.rows
          .map((row) => (row.values[parsed.register.columns.employee_number] ?? '').trim().toUpperCase())
          .filter(Boolean)
      )];
      const employeeRows = numbers.length
        ? await tx.employee.findMany({
            where: { organizationId: input.organizationId, employeeNumber: { in: numbers } },
            select: { id: true, employeeNumber: true, status: true, joinedAt: true },
          })
        : [];
      const employees = new Map<string, EmployeeReference>(
        employeeRows.map((employee) => [
          employee.employeeNumber,
          { ...employee, joinedAt: employee.joinedAt.toISOString().slice(0, 10) },
        ])
      );

      const result = validateParsedRegister(parsed.register, employees);
      batchFindings = result.batchFindings;
      currency = result.currency;
      payPeriodStart = result.payPeriodStart;
      payPeriodEnd = result.payPeriodEnd;
      errorCount = result.errorCount;
      warningCount = result.warningCount;
      infoCount = result.infoCount;
      validRowCount = result.validRowCount;
      invalidRowCount = result.invalidRowCount;
      records = result.records.map((record) => ({ ...record, id: randomUUID() }));
    }

    await tx.payrollImportBatch.create({
      data: {
        id: batchId,
        organizationId: input.organizationId,
        createdById: input.userId,
        originalFilename: filename,
        storageKey,
        fileHash,
        fileSizeBytes: input.buffer.length,
        rulesetVersion: RULESET_VERSION,
        status,
        rowCount: records.length,
        validRowCount,
        invalidRowCount,
        errorCount,
        warningCount,
        infoCount,
        currency,
        payPeriodStart: payPeriodStart ? new Date(`${payPeriodStart}T00:00:00.000Z`) : null,
        payPeriodEnd: payPeriodEnd ? new Date(`${payPeriodEnd}T00:00:00.000Z`) : null,
        retentionUntil: new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000),
        completedAt: new Date(),
      },
    });

    for (let index = 0; index < records.length; index += 500) {
      await tx.importedPayrollRecord.createMany({
        data: records.slice(index, index + 500).map((record) => ({
          id: record.id,
          organizationId: input.organizationId,
          batchId,
          employeeId: record.employeeId,
          employeeNumber: record.employeeNumber,
          rowNumber: record.rowNumber,
          payPeriodStart: record.payPeriodStart ? new Date(`${record.payPeriodStart}T00:00:00.000Z`) : null,
          payPeriodEnd: record.payPeriodEnd ? new Date(`${record.payPeriodEnd}T00:00:00.000Z`) : null,
          currency: record.currency,
          grossPay: record.grossPay,
          totalDeductions: record.totalDeductions,
          netPay: record.netPay,
          isValid: record.isValid,
        })),
      });
    }

    const findingRows = [
      ...batchFindings.map((finding) => ({ ...finding, recordId: null as string | null })),
      ...records.flatMap((record) =>
        record.findings.map((finding) => ({ ...finding, recordId: record.id }))
      ),
    ];

    for (let index = 0; index < findingRows.length; index += 1000) {
      await tx.validationFinding.createMany({
        data: findingRows.slice(index, index + 1000).map((finding) => ({
          organizationId: input.organizationId,
          batchId,
          recordId: finding.recordId,
          rowNumber: finding.rowNumber ?? null,
          field: finding.field ?? null,
          ruleCode: finding.ruleCode,
          severity: RULE_SEVERITY[finding.ruleCode],
          message: finding.message,
          expected: finding.expected ?? null,
          actual: finding.actual ?? null,
        })),
      });
    }

    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        actorId: input.userId,
        action: 'payroll_import.created',
        entityType: 'PayrollImportBatch',
        entityId: batchId,
        metadata: {
          status,
          rowCount: records.length,
          validRowCount,
          invalidRowCount,
          rulesetVersion: RULESET_VERSION,
        },
      },
    });

    const batch = await tx.payrollImportBatch.findUniqueOrThrow({
      where: { id: batchId },
      include: CREATOR_INCLUDE,
    });

    return toBatchDto(batch as BatchWithCreator);
  } catch (error) {
    await deleteImportFileQuietly(storageKey);
    throw error;
  }
}
```

Add the read functions:

```ts
export async function listPayrollImports(tx: Tx, organizationId: string, query: PayrollImportListQuery) {
  const where: Prisma.PayrollImportBatchWhereInput = { organizationId };
  if (query.status) where.status = query.status;

  const [total, batches] = await Promise.all([
    tx.payrollImportBatch.count({ where }),
    tx.payrollImportBatch.findMany({
      where,
      include: CREATOR_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    batches: batches.map((batch) => toBatchDto(batch as BatchWithCreator)),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  };
}

async function requireBatch(tx: Tx, organizationId: string, batchId: string) {
  const batch = await tx.payrollImportBatch.findFirst({ where: { id: batchId, organizationId } });
  if (!batch) throw new HttpError(404, 'PAYROLL_IMPORT_NOT_FOUND', 'Payroll import not found');
  return batch;
}

export async function getPayrollImport(tx: Tx, organizationId: string, batchId: string) {
  const batch = await tx.payrollImportBatch.findFirst({
    where: { id: batchId, organizationId },
    include: CREATOR_INCLUDE,
  });
  if (!batch) throw new HttpError(404, 'PAYROLL_IMPORT_NOT_FOUND', 'Payroll import not found');
  return toBatchDto(batch as BatchWithCreator);
}

export async function listImportedRecords(tx: Tx, organizationId: string, batchId: string, query: ImportedRecordListQuery) {
  await requireBatch(tx, organizationId, batchId);
  const where: Prisma.ImportedPayrollRecordWhereInput = { organizationId, batchId };
  if (query.valid !== undefined) where.isValid = query.valid;

  const [total, records] = await Promise.all([
    tx.importedPayrollRecord.count({ where }),
    tx.importedPayrollRecord.findMany({
      where,
      include: { employee: { select: { firstName: true, lastName: true } } },
      orderBy: { rowNumber: 'asc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    records: records.map((record) => toRecordDto(record as RecordWithEmployee)),
    pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) },
  };
}

export async function listFindings(tx: Tx, organizationId: string, batchId: string, query: FindingListQuery) {
  await requireBatch(tx, organizationId, batchId);
  const where: Prisma.ValidationFindingWhereInput = { organizationId, batchId };
  if (query.severity) where.severity = query.severity;
  if (query.ruleCode) where.ruleCode = query.ruleCode;

  const [total, findings] = await Promise.all([
    tx.validationFinding.count({ where }),
    tx.validationFinding.findMany({
      where,
      orderBy: [{ rowNumber: 'asc' }, { ruleCode: 'asc' }, { field: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    findings: findings.map((finding) => toFindingDto(finding)),
    pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) },
  };
}

export async function buildExceptionReportRows(tx: Tx, organizationId: string, batchId: string) {
  await requireBatch(tx, organizationId, batchId);
  const findings = await tx.validationFinding.findMany({
    where: { organizationId, batchId },
    include: { record: true },
    orderBy: [{ rowNumber: 'asc' }, { ruleCode: 'asc' }, { field: 'asc' }],
  });

  return findings.map((finding) => ({
    rowNumber: finding.rowNumber,
    employeeNumber: finding.record?.employeeNumber ?? null,
    payPeriodStart: finding.record?.payPeriodStart?.toISOString().slice(0, 10) ?? null,
    payPeriodEnd: finding.record?.payPeriodEnd?.toISOString().slice(0, 10) ?? null,
    currency: finding.record?.currency ?? null,
    grossPay: finding.record?.grossPay?.toFixed(2) ?? null,
    totalDeductions: finding.record?.totalDeductions?.toFixed(2) ?? null,
    netPay: finding.record?.netPay?.toFixed(2) ?? null,
    severity: finding.severity,
    ruleCode: finding.ruleCode,
    field: finding.field,
    message: finding.message,
    expected: finding.expected,
    actual: finding.actual,
  }));
}
```

Import `RULE_SEVERITY` from types.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck --workspace=apps/api` and `npm run typecheck:tests --workspace=apps/api`
Expected: PASS (unused type imports may need cleanup).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/features/payrollImport
git commit -m "feat(api): add payroll import service and DTOs"
```

---

### Task 7: Router, file responses, and error mapping

**Files:**
- Modify: `apps/api/src/middleware/auth.ts`
- Modify: `apps/api/src/middleware/errorHandler.ts`
- Create: `apps/api/src/features/payrollImport/payrollImport.routes.ts`
- Modify: `apps/api/src/routes/index.ts`

- [ ] **Step 1: Extend the tenant response for CSV downloads**

In `apps/api/src/middleware/auth.ts`, replace `TenantRouteResponse` and the send block:

```ts
export interface TenantRouteResponse {
  status?: number;
  location?: string;
  body?: unknown;
  file?: { content: string; contentType: string; filename: string };
}
```

```ts
      const response = await withOrganizationContext(organizationId, (tx) =>
        handler(req, tx)
      );

      if (response.file) {
        res
          .status(response.status ?? 200)
          .set('Content-Type', response.file.contentType)
          .set('Content-Disposition', `attachment; filename="${response.file.filename}"`)
          .set('Cache-Control', 'no-store')
          .send(response.file.content);
        return;
      }

      if (response.location) {
        res.location(response.location);
      }

      res.status(response.status ?? 200).json(response.body);
```

- [ ] **Step 2: Map oversized payloads**

In `apps/api/src/middleware/errorHandler.ts`, before computing the status:

```ts
  const payloadTooLarge =
    typeof err === 'object' &&
    err !== null &&
    (err as { type?: string }).type === 'entity.too.large';

  const statusCode = payloadTooLarge ? 413 : err.statusCode || 500;
  const message = payloadTooLarge
    ? 'The uploaded file is too large.'
    : err.message || 'Internal Server Error';
  const code = payloadTooLarge ? 'PAYLOAD_TOO_LARGE' : err.code || 'INTERNAL_ERROR';
```

Remove the old `statusCode`, `message`, and `code` declarations.

- [ ] **Step 3: Implement the router**

```ts
import express, { RequestHandler, Router } from 'express';
import { UserRole } from '@prisma/client';
import { ZodTypeAny } from 'zod';
import { requireAuth, requireRole, tenantRouteHandler } from '../../middleware/auth';
import { HttpError } from '../../lib/httpError';
import { AuthenticatedRequest } from '../../types/auth';
import { MAX_FILE_BYTES } from './payrollImport.types';
import {
  findingListQuerySchema,
  importedRecordListQuerySchema,
  payrollImportIdSchema,
  payrollImportListQuerySchema,
} from './payrollImport.schema';
import {
  buildExceptionReportRows,
  getPayrollImport,
  importPayrollCsv,
  listFindings,
  listImportedRecords,
  listPayrollImports,
} from './payrollImport.service';
import { buildExceptionReportCsv } from './export';

const HR_ROLES = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR_MANAGER] as const;

function parse<T extends ZodTypeAny>(schema: T, value: unknown): ReturnType<T['parse']> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'Invalid request',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }))
    );
  }
  return result.data;
}

function actor(req: AuthenticatedRequest) {
  if (!req.auth) {
    throw new HttpError(401, 'NOT_AUTHENTICATED', 'Authentication required');
  }
  return { organizationId: req.auth.organization.id, userId: req.auth.user.id };
}

function decodeFilename(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function createPayrollImportsRouter(
  authMiddleware: RequestHandler = requireAuth
): Router {
  const router = Router();
  router.use(authMiddleware, requireRole(...HR_ROLES));

  router.get(
    '/',
    tenantRouteHandler(async (req, tx) => {
      const { organizationId } = actor(req);
      const query = parse(payrollImportListQuerySchema, req.query);
      const result = await listPayrollImports(tx, organizationId, query);
      return { body: { success: true, data: result } };
    })
  );

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
      return {
        status: 201,
        location: `/api/payroll-imports/${batch.id}`,
        body: { success: true, data: { batch } },
      };
    })
  );

  router.get(
    '/:id/records',
    tenantRouteHandler(async (req, tx) => {
      const { organizationId } = actor(req);
      const id = parse(payrollImportIdSchema, req.params.id);
      const query = parse(importedRecordListQuerySchema, req.query);
      const result = await listImportedRecords(tx, organizationId, id, query);
      return { body: { success: true, data: result } };
    })
  );

  router.get(
    '/:id/findings',
    tenantRouteHandler(async (req, tx) => {
      const { organizationId } = actor(req);
      const id = parse(payrollImportIdSchema, req.params.id);
      const query = parse(findingListQuerySchema, req.query);
      const result = await listFindings(tx, organizationId, id, query);
      return { body: { success: true, data: result } };
    })
  );

  router.get(
    '/:id/exception-report',
    tenantRouteHandler(async (req, tx) => {
      const { organizationId } = actor(req);
      const id = parse(payrollImportIdSchema, req.params.id);
      const rows = await buildExceptionReportRows(tx, organizationId, id);
      return {
        file: {
          content: buildExceptionReportCsv(rows),
          contentType: 'text/csv; charset=utf-8',
          filename: `payroll-exceptions-${id}.csv`,
        },
      };
    })
  );

  router.get(
    '/:id',
    tenantRouteHandler(async (req, tx) => {
      const { organizationId } = actor(req);
      const id = parse(payrollImportIdSchema, req.params.id);
      const batch = await getPayrollImport(tx, organizationId, id);
      return { body: { success: true, data: { batch } } };
    })
  );

  return router;
}

export const payrollImportsRouter = createPayrollImportsRouter();
```

- [ ] **Step 4: Mount the router**

```ts
import { payrollImportsRouter } from '../features/payrollImport/payrollImport.routes';
apiRouter.use('/payroll-imports', payrollImportsRouter);
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck --workspace=apps/api && npm run test:integration 2>&1 | tail -5`
Expected: typecheck passes; existing 98 integration tests still pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/middleware apps/api/src/features/payrollImport apps/api/src/routes/index.ts
git commit -m "feat(api): expose payroll import endpoints"
```

---

### Task 8: PostgreSQL integration tests

**Files:**
- Create: `apps/api/src/features/payrollImport/payrollImport.integration.test.ts`
- Test: uses `RUN_DB_INTEGRATION=1`, `DATABASE_URL` (runtime role), `DIRECT_URL` (migrator).

Run this file only with: `NODE_ENV=test RUN_DB_INTEGRATION=1 npx tsx --test apps/api/src/features/payrollImport/payrollImport.integration.test.ts`

Use dedicated fixtures so concurrent test files do not race:

```ts
const orgD = '88888888-8888-4888-8888-888888888888';
const orgE = '99999999-9999-4999-8999-999999999999';
const userD = '88888888-8888-4888-8888-888888888801';
const userE = '99999999-9999-4999-8999-999999999901';
```

- [ ] **Step 1: Set up fixtures**

`before` with the migrator client:
- Upsert both organizations.
- Upsert users (`identityIssuer: 'test'`, `identitySubject: 'subject-...'`, roles `HR_MANAGER`).
- Delete prior import batches for both organizations (cascade removes records/findings).
- Create employees `PP-3001` (ACTIVE, joined 2020-01-01), `PP-3002` (TERMINATED, joined 2019-01-01), `PP-3003` (ON_LEAVE, joined 2021-06-01) in org D, and `PP-4001` in org E.
- Store the employee ids.
- Set `process.env.PAYROLL_IMPORT_STORAGE_DIR` to a temp directory created with `mkdtemp`.
- Start an Express app with `createPayrollImportsRouter(fakeAuth)` and `express.raw` handled inside the router, plus `errorHandler`; listen on port 0.

`after`: delete batches, users, employees, organizations; remove the temp storage directory; disconnect the migrator client; close the server.

`fakeAuth` mirrors `employees.integration.test.ts`: `x-test-org` selects `userD`/`userE`; `x-test-role` defaults to `HR_MANAGER`.

- [ ] **Step 2: Cover the pipeline and rules**

```ts
const HEADER = 'employee_number,pay_period_start,pay_period_end,currency,gross_pay,total_deductions,net_pay';
const validRow = `${HEADER}\nPP-3001,2026-10-01,2026-10-31,INR,75000.00,12500.00,62500.00\n`;

async function upload(org: string, body: string, name = 'register.csv', role = 'HR_MANAGER') {
  const response = await fetch(`${baseUrl}/payroll-imports`, {
    method: 'POST',
    headers: {
      'content-type': 'text/csv',
      'x-test-org': org,
      'x-test-role': role,
      'x-file-name': encodeURIComponent(name),
    },
    body,
  });
  return { status: response.status, body: await response.json() };
}
```

Assertions:
- Valid upload returns 201, `status === 'COMPLETED'`, `rowCount === 1`, `validRowCount === 1`, `invalidRowCount === 0`, `currency === 'INR'`, and the month dates.
- Detail endpoint returns the same batch; another organization gets 404.
- Records endpoint returns the resolved employee id/name and `isValid === true`.
- Findings endpoint is empty for a clean file.
- Unknown employee (`PP-9999`) returns 201, one record, one `UNKNOWN_EMPLOYEE` error, summary `invalidRowCount === 1`; no employee is created.
- Terminated employee with a historical period is accepted (`COMPLETED`, `invalidRowCount === 0`) and gets only `EMPLOYEE_INACTIVE` warning; the report contains the warning.
- Arithmetic mismatch produces `ARITHMETIC_MISMATCH` with expected `62500.00` and actual `63000.00`.
- Precision `1.234` produces `UNSUPPORTED_PRECISION`.
- Mixed currency and mixed period produce `INCONSISTENT_CURRENCY` and `INCONSISTENT_PAY_PERIOD`.
- Duplicate employee/period in one file produces `DUPLICATE_EMPLOYEE_PERIOD` on row 2.
- Extra column produces `UNEXPECTED_COLUMN` warning and still completes.
- A file missing `net_pay` returns 201 with `status === 'FAILED'`, zero records, and `INVALID_HEADER`.
- An empty Upload (zero bytes) returns 201 with `status === 'FAILED'` and `EMPTY_FILE`.
- A payload over 5 MB returns 413 with code `PAYLOAD_TOO_LARGE`.
- A file with 10,001 data rows returns 201 with `FAILED` and `TOO_MANY_ROWS` (use short rows).
- Filtering findings by `severity=ERROR` and records by `valid=false` narrows the result.

- [ ] **Step 3: Cover duplicates, concurrency, and rollback**

- Upload `validRow` as `a.csv`; upload identical bytes as `b.csv` → 409 `DUPLICATE_IMPORT`. Filename change does not bypass the hash.
- Upload a malformed file (wrong header) → `FAILED`; upload the same bytes again → 201, proving failed batches may be retried.
- Concurrent identical uploads via `Promise.all` from two new connections → one 201, one 409; query the count of `COMPLETED` batches with that hash is 1.
- Rollback: inside `withOrganizationContext(orgD, async (tx) => { await importPayrollCsv(tx, {...valid input...}); throw new Error('rollback'); })`, assert the call rejects, then assert no batch/records/findings exist for that hash. File cleanup after transaction failure is verified by checking the storage directory contains no file for the discarded batch id when the transaction is rolled back inside `importPayrollCsv`; the outer-throw case may leave a file and is covered by the purge script, so assert database emptiness only.
- Audit: query `audit_logs` for `payroll_import.created`; metadata has row counts and ruleset version, and serialized metadata contains no salary values, employee names, or employee numbers.

- [ ] **Step 4: Cover RLS with the runtime role**

```ts
await assert.rejects(
  withOrganizationContext(orgE, (tx) =>
    tx.payrollImportBatch.findMany({ where: { organizationId: orgD } })
  )
);
```

Assert:
- Org E sees zero batches, records, and findings owned by org D.
- Inserting an org D batch while the context is org E is rejected by RLS.
- The runtime role cannot delete batches (no delete policy).
- Existing employee resolution remains organization-scoped: org D cannot resolve org E's `PP-4001`.

- [ ] **Step 5: Cover the HTTP boundary and export**

- No token → 401; `MANAGER`/`EMPLOYEE` role → 403.
- `GET /payroll-imports/:id/exception-report` returns `text/csv`, an attachment filename, `Cache-Control: no-store`, and a header row.
- A message containing `=SUM(A1)` is exported as `'=SUM(A1)` inside quotes.
- Pagination caps `pageSize` at 100; invalid ids return 400; unknown ids return 404.
- History filters by `status=FAILED`.

- [ ] **Step 6: Run**

```bash
NODE_ENV=test RUN_DB_INTEGRATION=1 npx tsx --test apps/api/src/features/payrollImport/payrollImport.integration.test.ts
```
Expected: all payroll integration tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/features/payrollImport/payrollImport.integration.test.ts
git commit -m "test(api): cover payroll import pipeline and tenant isolation"
```

---

### Task 9: Web types and API client

**Files:**
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/lib/payrollImports.ts`

- [ ] **Step 1: Add DTO types**

```ts
export type PayrollImportStatus = 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type ValidationSeverity = 'ERROR' | 'WARNING' | 'INFO';

export interface PayrollImportBatch {
  id: string;
  originalFilename: string;
  status: PayrollImportStatus;
  rulesetVersion: string;
  rowCount: number;
  validRowCount: number;
  invalidRowCount: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  currency: string | null;
  payPeriodStart: string | null;
  payPeriodEnd: string | null;
  fileSizeBytes: number;
  retentionUntil: string;
  filePurgedAt: string | null;
  createdAt: string;
  completedAt: string | null;
  createdBy: { id: string; email: string } | null;
}

export interface PayrollImportRecord {
  id: string;
  rowNumber: number;
  employeeId: string | null;
  employeeNumber: string;
  employeeName: string | null;
  payPeriodStart: string | null;
  payPeriodEnd: string | null;
  currency: string | null;
  grossPay: string | null;
  totalDeductions: string | null;
  netPay: string | null;
  isValid: boolean;
}

export interface PayrollImportFinding {
  id: string;
  rowNumber: number | null;
  field: string | null;
  ruleCode: string;
  severity: ValidationSeverity;
  message: string;
  expected: string | null;
  actual: string | null;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PayrollImportsResult {
  batches: PayrollImportBatch[];
  pagination: Pagination;
}

export interface PayrollImportRecordsResult {
  records: PayrollImportRecord[];
  pagination: Pagination;
}

export interface PayrollImportFindingsResult {
  findings: PayrollImportFinding[];
  pagination: Pagination;
}
```

- [ ] **Step 2: Add raw upload and download to the client**

Inside `ApiClient`:

```ts
  async uploadCsv<T>(endpoint: string, filename: string, content: string): Promise<T> {
    const headers = await this.getAuthHeaders();
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'text/csv',
        'X-File-Name': encodeURIComponent(filename),
      },
      body: content,
    });
    return this.handleResponse<T>(response);
  }

  async download(endpoint: string): Promise<{ blob: Blob; filename: string | null }> {
    const headers = await this.getAuthHeaders();
    const response = await fetch(`${API_BASE_URL}${endpoint}`, { method: 'GET', headers });

    if (response.status === 401) {
      keycloak.clearToken();
      throw new ApiError('Session expired', 401, 'SESSION_EXPIRED');
    }

    if (!response.ok) {
      let message = 'Download failed';
      let code: string | undefined;
      try {
        const data = (await response.json()) as ApiResponse<unknown>;
        message = data.error?.message ?? message;
        code = data.error?.code;
      } catch {
        // Non-JSON error response.
      }
      throw new ApiError(message, response.status, code);
    }

    const disposition = response.headers.get('Content-Disposition') ?? '';
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? null;
    return { blob: await response.blob(), filename };
  }
```

- [ ] **Step 3: Add typed helpers**

```ts
import { api } from './api';
import type {
  PayrollImportBatch,
  PayrollImportFindingsResult,
  PayrollImportRecordsResult,
  PayrollImportsResult,
  ValidationSeverity,
} from '../types';

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const value = search.toString();
  return value ? `?${value}` : '';
}

export function listPayrollImports(params: {
  page?: number;
  pageSize?: number;
  status?: string;
}): Promise<PayrollImportsResult> {
  return api.get<PayrollImportsResult>(`/payroll-imports${query(params)}`);
}

export function getPayrollImport(id: string): Promise<{ batch: PayrollImportBatch }> {
  return api.get<{ batch: PayrollImportBatch }>(`/payroll-imports/${id}`);
}

export function listPayrollImportRecords(
  id: string,
  params: { page?: number; pageSize?: number; valid?: 'true' | 'false' }
): Promise<PayrollImportRecordsResult> {
  return api.get<PayrollImportRecordsResult>(`/payroll-imports/${id}/records${query(params)}`);
}

export function listPayrollImportFindings(
  id: string,
  params: { page?: number; pageSize?: number; severity?: ValidationSeverity; ruleCode?: string }
): Promise<PayrollImportFindingsResult> {
  return api.get<PayrollImportFindingsResult>(`/payroll-imports/${id}/findings${query(params)}`);
}

export function uploadPayrollImport(
  filename: string,
  content: string
): Promise<{ batch: PayrollImportBatch }> {
  return api.uploadCsv<{ batch: PayrollImportBatch }>('/payroll-imports', filename, content);
}

export function downloadExceptionReport(id: string) {
  return api.download(`/payroll-imports/${id}/exception-report`);
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck --workspace=apps/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/types apps/web/src/lib
git commit -m "feat(web): add payroll import API client"
```

---

### Task 10: Payroll Imports pages and navigation

**Files:**
- Create: `apps/web/src/components/payroll/PayrollImportStatusBadge.tsx`
- Create: `apps/web/src/components/payroll/ImportUploadCard.tsx`
- Create: `apps/web/src/pages/PayrollImportsPage.tsx`
- Create: `apps/web/src/pages/PayrollImportDetailPage.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/components/layout/Sidebar.tsx`
- Modify: `apps/web/src/components/layout/TopNav.tsx`

- [ ] **Step 1: Shared status badge**

Rules: `FAILED` → danger “Failed”; `COMPLETED` with `errorCount > 0` → warning “Completed with errors”; `COMPLETED` with zero errors → success “Valid”; `PROCESSING` → info “Processing”.

```tsx
import React from 'react';
import { Badge } from '../ui/Badge';
import type { PayrollImportBatch } from '../../types';

export const PayrollImportStatusBadge: React.FC<{ batch: PayrollImportBatch }> = ({ batch }) => {
  if (batch.status === 'PROCESSING') return <Badge variant="info" dot size="sm">Processing</Badge>;
  if (batch.status === 'FAILED') return <Badge variant="danger" dot size="sm">Failed</Badge>;
  if (batch.errorCount > 0) return <Badge variant="warning" dot size="sm">Completed with errors</Badge>;
  return <Badge variant="success" dot size="sm">Valid</Badge>;
};
```

- [ ] **Step 2: Upload card**

Required UI:
- `<input type="file" accept=".csv,text/csv" />`.
- Client checks: extension `.csv`, `file.size <= 5 * 1024 * 1024`.
- Reads with `await file.text()`, calls `uploadPayrollImport(file.name, text)`, reports the created batch through `onUploaded(batch)`.
- Shows required columns, an example row, limits, and “one currency/period per batch”.
- Shows inline `ApiError` messages, including `DUPLICATE_IMPORT`.
- Disables the button while uploading and shows `Loader2`.

- [ ] **Step 3: History page**

`PayrollImportsPage` state: `batches`, `pagination`, `status`, `page`, `loading`, `error`, `forbidden`, `recentBatch`.
- `load()` calls `listPayrollImports`.
- 403 renders the same “Access restricted” block used by `EmployeesPage`.
- Header: “Payroll Imports”, subtitle, upload card.
- Recent success message links to `/payroll/imports/:id`.
- Status filter: All, Completed, Failed, Processing.
- Table columns: File, Uploaded, Period, Currency, Status, Rows, Valid/Invalid, Errors/Warnings, Actions (View).
- Empty state: “No payroll imports yet”.
- Pagination: page size 25, Previous/Next, showing range.

- [ ] **Step 4: Detail page**

`PayrollImportDetailPage` uses `useParams<{ id: string }>()`, `getPayrollImport`, `listPayrollImportFindings`, `listPayrollImportRecords`.
- Summary cards: rows, valid, invalid, errors, warnings.
- Batch metadata: filename, uploader, ruleset version, retention date, file purged state.
- Tabs: Findings (default) and Records.
- Findings tab: severity filter (All/Error/Warning/Info), table columns Row, Severity, Rule, Field, Explanation, Expected, Actual; pagination.
- Records tab: validity filter (All/Valid/Invalid), table columns Row, Employee, Period, Currency, Gross, Deductions, Net, Status; pagination.
- Exception Report button calls `downloadExceptionReport`, creates an object URL, clicks a temporary anchor with the returned filename, revokes the URL, and shows an error if the request fails.
- 403 → access restricted; 404 → “Import not found”.

- [ ] **Step 5: Navigation**

- Router: lazy load both pages; add `payroll/imports` and `payroll/imports/:id` before the catch-all.
- Sidebar: add `{ label: 'Payroll Imports', path: '/payroll/imports', icon: FileUp }` after Payroll.
- TopNav: add titles/subtitles for `/payroll/imports` and a prefix fallback for `/payroll/imports/` detail pages.

- [ ] **Step 6: Verify**

Run: `npm run typecheck --workspace=apps/web && npm run build --workspace=apps/web`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/payroll apps/web/src/pages apps/web/src/app/router.tsx apps/web/src/components/layout
git commit -m "feat(web): add payroll imports history and detail"
```

---

### Task 11: Purge script and documentation

**Files:**
- Create: `scripts/purge-payroll-imports.ts`
- Modify: `package.json` (script `purge:payroll-imports`)
- Modify: `README.md`

- [ ] **Step 1: Implement the purge script**

```ts
#!/usr/bin/env tsx
import path from 'node:path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { deleteImportFileQuietly } from '../apps/api/src/features/payrollImport/storage';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
  if (!process.env.DIRECT_URL) throw new Error('DIRECT_URL is required');

  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
  const now = new Date();

  try {
    const expired = await prisma.payrollImportBatch.findMany({
      where: { retentionUntil: { lt: now }, storageKey: { not: null } },
      select: { id: true, storageKey: true },
    });

    let removed = 0;
    for (const batch of expired) {
      if (!batch.storageKey) continue;
      await deleteImportFileQuietly(batch.storageKey);
      await prisma.payrollImportBatch.update({
        where: { id: batch.id },
        data: { storageKey: null, filePurgedAt: now },
      });
      removed += 1;
    }

    console.log(`Purged ${removed} expired payroll import file(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
```

`package.json`: `"purge:payroll-imports": "tsx scripts/purge-payroll-imports.ts"`.

- [ ] **Step 2: Document the feature**

README updates:
- Phase note: payroll registers can be imported and validated; imported records are not payslips.
- Endpoint table rows for the six endpoints.
- New subsection “Payroll register imports” with:
  - The CSV header and one sample row.
  - ISO dates, uppercase three-letter currency, two-decimal money, 5 MB and 10,000-row limits.
  - One currency and one period per batch.
  - Role restriction to `SUPER_ADMIN`, `ADMIN`, `HR_MANAGER`.
  - File-level vs row-level failures, duplicate-hash behavior, and failed-batch retry.
  - Rules summary and `payroll-import-rules/v1`.
  - Private storage path, 90-day retention, and `npm run purge:payroll-imports`.
  - Imported records are never written to `payslips` or `payroll_runs`.
- Milestone list entry.

- [ ] **Step 3: Verify the script loads**

Run: `npx tsx scripts/purge-payroll-imports.ts`
Expected: `Purged 0 expired payroll import file(s).` or a count, with no errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/purge-payroll-imports.ts package.json README.md
git commit -m "docs: document payroll imports and add retention purge"
```

---

### Task 12: Full verification and handoff

- [ ] **Step 1: Automated verification**

```bash
npm run prisma:validate
npm run db:status
npm run typecheck
npm run typecheck:tests --workspace=apps/api
npm run build
npm test
npm run test:integration
```

Expected: schema valid, five migrations plus the new one applied, both typechecks and builds pass, unit tests pass, and all integration suites pass.

- [ ] **Step 2: Browser walkthrough**

Start `npm run dev` (web `5173`, API `4000`) and, as `admin@paypilot.local`:
- Open `/payroll/imports`; upload a valid file with two employees.
- Confirm history shows `Valid`, row counts, and currency.
- Open detail; confirm findings empty, records resolved with names, and the exception report downloads.
- Upload a file with arithmetic mismatch, unknown employee, duplicate row, and mixed currency; confirm counts, findings table, severity filter, and report contents.
- Upload the same completed file again; confirm the duplicate message.
- Sign in as `manager@paypilot.local`; confirm the access-restricted state.
- Confirm no controllers are added to the finalized Payroll page.

- [ ] **Step 3: Record results**

Append an “Execution notes” section to this plan with actual outputs, any unresolved issues, and screenshot paths. Do not claim production readiness.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-11-07-payroll-import-validation.md
git commit -m "docs: record payroll import verification"
```

- [ ] **Step 5: Draft PR**

If `gh auth status` succeeds and the remote permits it, push the branch and open a draft PR with a summary, verification results, and remaining risks. Otherwise report that no PR was created. Do not merge.

---

## Execution notes

Executed on branch `feat/payroll-import-validation` on 2026-11-07 through 2026-11-09.
Fourteen commits sit on top of `main` (`9f91d0c`):

| Commit | Purpose |
|---|---|
| `af07b7d` | Design spec |
| `8347165` | Implementation plan |
| `b20c5fb` | Prisma enums/models, migration, RLS policies |
| `eba556a` | Domain types, RFC 4180 parser, parser tests |
| `bdd3206` | Deterministic validation engine and tests |
| `9c17773` | Safe exception-report CSV builder and tests |
| `5340e9f` | Private file storage, `.gitignore`, `.env.example` |
| `48f412d` | DTOs, query schemas, tenant-scoped service |
| `0668f44` | Router, CSV response support, 413 mapping, mount |
| `cd7f5c0` | Attach source row numbers to row-level findings |
| `fb54381` | PostgreSQL integration suite (26 tests) |
| `36dd6d3` | Web types and authenticated upload/download client |
| `b36c642` | Payroll Imports history/detail pages and navigation |
| `dbded30` | Retention purge script and README documentation |

### Automated verification

Run from the repository root on the committed tree:

```text
npm run prisma:validate   -> The schema at prisma/schema.prisma is valid
npm run db:status         -> 6 migrations found; Database schema is up to date!
npm run typecheck         -> API and web typechecks pass
npm run typecheck:tests --workspace=apps/api -> pass
npm run build             -> API and web builds pass
npm test                  -> 84 tests, 84 pass, 0 fail
npm run test:integration  -> 155 tests, 155 pass, 0 fail
npm run purge:payroll-imports -> Purged 0 expired payroll import file(s).
```

The payroll-import feature contributes 33 unit tests (`csv` 7, `validation` 16,
`export` 6, `storage` 4) and 26 PostgreSQL integration tests.

Migration note: `prisma migrate dev` fails with `P3014` because the migrator role
does not own `CREATEDB`. The migration was generated with `prisma migrate diff`
and applied with `prisma migrate deploy`; `db:status` confirms it is applied.

RLS was verified directly in PostgreSQL after the migration:

```text
imported_payroll_records|t|t
payroll_import_batches|t|t
validation_findings|t|t
```

Each table has `ENABLE` and `FORCE` row-level security, tenant `SELECT`/`INSERT`
policies for `paypilot_app`, an `UPDATE` policy only on batches, and permissive
`paypilot_migrator` policies for migrations and the retention purge. The runtime
role has no delete policy on imports.

The integration suite covers: valid import and detail/records/findings/history,
cross-tenant 404s, unknown employees (no auto-create), inactive employees as
warnings only, arithmetic mismatches with expected/actual, precision, mixed
currency/period, duplicate employee periods, unexpected columns, file-level
`FAILED` batches, size limit (413), severity/validity filters, duplicate imports
(409), failed-file retry, concurrent identical uploads (one 201 and one 409),
transaction rollback, audit metadata without salaries/names, RLS reads/inserts/
deletes, cross-tenant employee resolution, RBAC 401/403, exception-report
headers and formula neutralization, pagination caps, and status filtering.

### API walkthrough with real Keycloak authentication

The demo organization `paypilot-demo` started with no employees, so two
walkthrough employees were created through the authenticated API
(`PP-1001`, `PP-1002`) and three registers were uploaded with a real token
obtained through the Keycloak authorization-code + PKCE flow.

| Upload | Result |
|---|---|
| Valid two-row register | `201`, `COMPLETED`, 2 rows, 2 valid, 0 invalid, 0 errors, `INR` |
| Error register (mismatch, unknown employee, mixed currency, precision) | `201`, `COMPLETED`, 3 rows, 0 valid, 3 invalid, 4 errors |
| Invalid header | `201`, `FAILED`, 0 rows, `INVALID_HEADER` |

Findings returned for the error batch:

```text
1 | ERROR | ARITHMETIC_MISMATCH    |                  | 62500.00 | 63000.00
2 | ERROR | UNKNOWN_EMPLOYEE       | employee_number  |          | PP-9999
3 | ERROR | INCONSISTENT_CURRENCY  | currency         | INR      | USD
3 | ERROR | UNSUPPORTED_PRECISION  | gross_pay        | 0.00     | 1.234
```

The exception report returned `Content-Type: text/csv; charset=utf-8`,
`Content-Disposition: attachment; filename="payroll-exceptions-<id>.csv"`, and
`Cache-Control: no-store`. Requesting the same batch as `manager@paypilot.local`
returned `403 INSUFFICIENT_PERMISSIONS`.

### Browser walkthrough

No Playwright/Puppeteer dependency was added. The walkthrough used the installed
headless Google Chrome over the Chrome DevTools Protocol, signing in through the
real Keycloak form. All ten checks passed:

1. Unauthenticated `/payroll/imports` redirects to `/login`.
2. Keycloak sign-in returns to the app.
3. Admin sees the Payroll Imports page and 3 history rows.
4. Status filter narrows history to the `FAILED` batch.
5. Detail page shows all four findings with expected/actual values.
6. Severity filter returns the four `ERROR` findings.
7. Records tab renders resolved and unresolved employee rows.
8. Exception Report button downloads a CSV from the UI.
9. Unknown batch id shows the "Import not found" state.
10. `manager@paypilot.local` sees the "Access restricted" state.

Screenshots (kept outside the repository, not committed):

```text
/tmp/opencode/walkthrough/01-imports-history.png
/tmp/opencode/walkthrough/02-imports-filtered-failed.png
/tmp/opencode/walkthrough/03-import-detail-findings.png
/tmp/opencode/walkthrough/04-findings-error-filter.png
/tmp/opencode/walkthrough/05-import-records-tab.png
/tmp/opencode/walkthrough/06-import-not-found.png
/tmp/opencode/walkthrough/07-manager-restricted.png
```

### Deviations and fixes during execution

- The API test script now quotes its glob (`tsx --test "src/**/*.test.ts"`) so
  nested feature tests are discovered; before this, the new suites were silently
  skipped.
- The first integration run exposed a real bug: row-level findings were stored
  with a `null` `rowNumber`. Fixed in `cd7f5c0`; every row-level finding now
  carries its source row and the integration test asserts it.
- Duplicate detection is scoped to `COMPLETED` batches so a `FAILED` file can be
  corrected and retried. Concurrent identical uploads are serialized with a
  transaction-scoped advisory lock keyed by organization and file hash.
- `PROCESSING` exists in the enum for forward compatibility, but the pipeline is
  synchronous: a batch is persisted as `COMPLETED` or `FAILED` before the
  response. No request can currently observe `PROCESSING`.
- The 5 MB limit is enforced by the body parser before storage, so oversized
  uploads are rejected with `413 PAYLOAD_TOO_LARGE` and leave no batch or file.
- Formula-injection neutralization prefixes cells beginning with `=`, `+`, `-`,
  `@`, tab, or carriage return with a single quote.

### Residual risks and open items

- The retention purge script was exercised (`0` expired files) but no test
  creates a genuinely expired batch and asserts that the file disappears while
  metadata survives. A dedicated integration test would close this gap.
- The history table needs horizontal scrolling at 1440 px because it has nine
  columns; the Actions button sits off-screen until scrolled. Functional but
  worth tightening in a follow-up.
- Imported records are validation input only. Nothing in this milestone writes
  to `payroll_runs` or `payslips`, and there is no reconciliation with finalized
  payroll yet.
- The browser walkthrough used the local demo organization. The walkthrough
  fixtures (`PP-1001`, `PP-1002`, and three import batches) were left in the
  development database so the reviewer can reproduce the UI; they are not part
  of the repository. To remove them, delete the batches and the two employees
  with the migrator connection, then delete the `payroll_import.created` audit
  rows for those batch ids.
- The working tree contained unrelated, in-progress attendance/leave work while
  these notes were written. It was not modified or committed as part of this
  milestone.
- No production-readiness claim is made. This is a reviewed development
  milestone, not a deployment sign-off.
