-- CreateEnum
CREATE TYPE "PayrollImportStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ValidationSeverity" AS ENUM ('ERROR', 'WARNING', 'INFO');

-- CreateTable
CREATE TABLE "payroll_import_batches" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "created_by_id" TEXT,
    "original_filename" TEXT NOT NULL,
    "storage_key" TEXT,
    "file_hash" TEXT NOT NULL,
    "file_size_bytes" INTEGER NOT NULL,
    "ruleset_version" TEXT NOT NULL,
    "status" "PayrollImportStatus" NOT NULL DEFAULT 'PROCESSING',
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "valid_row_count" INTEGER NOT NULL DEFAULT 0,
    "invalid_row_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "warning_count" INTEGER NOT NULL DEFAULT 0,
    "info_count" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT,
    "pay_period_start" DATE,
    "pay_period_end" DATE,
    "retention_until" TIMESTAMP(3) NOT NULL,
    "file_purged_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "payroll_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imported_payroll_records" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "employee_id" TEXT,
    "employee_number" TEXT NOT NULL,
    "row_number" INTEGER NOT NULL,
    "pay_period_start" DATE,
    "pay_period_end" DATE,
    "currency" TEXT,
    "gross_pay" DECIMAL(14,2),
    "total_deductions" DECIMAL(14,2),
    "net_pay" DECIMAL(14,2),
    "is_valid" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "imported_payroll_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "validation_findings" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "record_id" TEXT,
    "row_number" INTEGER,
    "field" TEXT,
    "rule_code" TEXT NOT NULL,
    "severity" "ValidationSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "expected" TEXT,
    "actual" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "validation_findings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_import_batches_organization_id_created_at_idx" ON "payroll_import_batches"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "payroll_import_batches_organization_id_status_idx" ON "payroll_import_batches"("organization_id", "status");

-- CreateIndex
CREATE INDEX "payroll_import_batches_organization_id_file_hash_idx" ON "payroll_import_batches"("organization_id", "file_hash");

-- CreateIndex
CREATE INDEX "imported_payroll_records_organization_id_batch_id_idx" ON "imported_payroll_records"("organization_id", "batch_id");

-- CreateIndex
CREATE INDEX "imported_payroll_records_employee_id_idx" ON "imported_payroll_records"("employee_id");

-- CreateIndex
CREATE INDEX "validation_findings_organization_id_batch_id_severity_idx" ON "validation_findings"("organization_id", "batch_id", "severity");

-- CreateIndex
CREATE INDEX "validation_findings_batch_id_row_number_idx" ON "validation_findings"("batch_id", "row_number");

-- AddForeignKey
ALTER TABLE "payroll_import_batches" ADD CONSTRAINT "payroll_import_batches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_import_batches" ADD CONSTRAINT "payroll_import_batches_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imported_payroll_records" ADD CONSTRAINT "imported_payroll_records_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imported_payroll_records" ADD CONSTRAINT "imported_payroll_records_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "payroll_import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imported_payroll_records" ADD CONSTRAINT "imported_payroll_records_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validation_findings" ADD CONSTRAINT "validation_findings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validation_findings" ADD CONSTRAINT "validation_findings_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "payroll_import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validation_findings" ADD CONSTRAINT "validation_findings_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "imported_payroll_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row-level security for payroll imports. Imported registers are tenant data:
-- they are readable and insertable by the runtime role within its organization,
-- batches are also updatable for status/count/purge updates, and nothing is
-- deletable by the runtime role. The migrator role keeps a permissive policy so
-- migrations and the retention purge script continue to work with FORCE RLS.
ALTER TABLE public.payroll_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_import_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE public.imported_payroll_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imported_payroll_records FORCE ROW LEVEL SECURITY;
ALTER TABLE public.validation_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.validation_findings FORCE ROW LEVEL SECURITY;

-- Payroll import batches
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

-- Imported payroll records are append-only for the runtime role.
CREATE POLICY imported_payroll_records_app_select ON public.imported_payroll_records
  FOR SELECT TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());
CREATE POLICY imported_payroll_records_app_insert ON public.imported_payroll_records
  FOR INSERT TO paypilot_app
  WITH CHECK (organization_id = public.paypilot_current_organization_id());

-- Validation findings are append-only for the runtime role.
CREATE POLICY validation_findings_app_select ON public.validation_findings
  FOR SELECT TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());
CREATE POLICY validation_findings_app_insert ON public.validation_findings
  FOR INSERT TO paypilot_app
  WITH CHECK (organization_id = public.paypilot_current_organization_id());

-- Migrator policies for migrations and the controlled retention purge.
CREATE POLICY payroll_import_batches_migrator_all ON public.payroll_import_batches
  FOR ALL TO paypilot_migrator USING (true) WITH CHECK (true);
CREATE POLICY imported_payroll_records_migrator_all ON public.imported_payroll_records
  FOR ALL TO paypilot_migrator USING (true) WITH CHECK (true);
CREATE POLICY validation_findings_migrator_all ON public.validation_findings
  FOR ALL TO paypilot_migrator USING (true) WITH CHECK (true);

-- Explicit runtime privileges; ALTER DEFAULT PRIVILEGES already covers tables
-- created by the migrator, but restating them keeps this migration self-contained.
GRANT SELECT, INSERT, UPDATE ON public.payroll_import_batches TO paypilot_app;
GRANT SELECT, INSERT ON public.imported_payroll_records TO paypilot_app;
GRANT SELECT, INSERT ON public.validation_findings TO paypilot_app;
