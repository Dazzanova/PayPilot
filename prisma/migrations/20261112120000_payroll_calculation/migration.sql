-- Add the post-calculation state. The value is added in its own statement and
-- is not used inside this migration transaction.
ALTER TYPE "PayrollStatus" ADD VALUE 'CALCULATED';

-- CreateEnum
CREATE TYPE "DeductionRuleType" AS ENUM ('RATE', 'FIXED');
CREATE TYPE "PayslipLineKind" AS ENUM ('EARNING', 'DEDUCTION');

-- AlterTable
ALTER TABLE "payroll_runs"
  ADD COLUMN "calculated_at" TIMESTAMP(3),
  ADD COLUMN "approved_at" TIMESTAMP(3),
  ADD COLUMN "paid_at" TIMESTAMP(3),
  ADD COLUMN "voided_at" TIMESTAMP(3),
  ADD COLUMN "void_reason" TEXT;

-- AlterTable
ALTER TABLE "payslips"
  ADD COLUMN "base_salary" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "working_days" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "paid_days" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "unpaid_days" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "absent_days" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "payroll_deduction_rules" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DeductionRuleType" NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_deduction_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslip_line_items" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "payslip_id" TEXT NOT NULL,
    "kind" "PayslipLineKind" NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "rule_id" TEXT,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payslip_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payroll_deduction_rules_organization_id_name_key"
  ON "payroll_deduction_rules"("organization_id", "name");
CREATE INDEX "payroll_deduction_rules_organization_id_active_idx"
  ON "payroll_deduction_rules"("organization_id", "active");
CREATE INDEX "payslip_line_items_organization_id_payslip_id_idx"
  ON "payslip_line_items"("organization_id", "payslip_id");

-- AddForeignKey
ALTER TABLE "payroll_deduction_rules" ADD CONSTRAINT "payroll_deduction_rules_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payslip_line_items" ADD CONSTRAINT "payslip_line_items_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payslip_line_items" ADD CONSTRAINT "payslip_line_items_payslip_id_fkey"
  FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payslip_line_items" ADD CONSTRAINT "payslip_line_items_rule_id_fkey"
  FOREIGN KEY ("rule_id") REFERENCES "payroll_deduction_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-level security. Deduction rules are tenant data that HR manages, so the
-- runtime role can select/insert/update/delete within its organization. Line
-- items are written with their payslip and removed by the payslip cascade.
ALTER TABLE public.payroll_deduction_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_deduction_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payslip_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payslip_line_items FORCE ROW LEVEL SECURITY;

CREATE POLICY payroll_deduction_rules_app_select ON public.payroll_deduction_rules
  FOR SELECT TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());
CREATE POLICY payroll_deduction_rules_app_insert ON public.payroll_deduction_rules
  FOR INSERT TO paypilot_app
  WITH CHECK (organization_id = public.paypilot_current_organization_id());
CREATE POLICY payroll_deduction_rules_app_update ON public.payroll_deduction_rules
  FOR UPDATE TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id())
  WITH CHECK (organization_id = public.paypilot_current_organization_id());
CREATE POLICY payroll_deduction_rules_app_delete ON public.payroll_deduction_rules
  FOR DELETE TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());

CREATE POLICY payslip_line_items_app_select ON public.payslip_line_items
  FOR SELECT TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());
CREATE POLICY payslip_line_items_app_insert ON public.payslip_line_items
  FOR INSERT TO paypilot_app
  WITH CHECK (organization_id = public.paypilot_current_organization_id());

CREATE POLICY payroll_deduction_rules_migrator_all ON public.payroll_deduction_rules
  FOR ALL TO paypilot_migrator USING (true) WITH CHECK (true);
CREATE POLICY payslip_line_items_migrator_all ON public.payslip_line_items
  FOR ALL TO paypilot_migrator USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_deduction_rules TO paypilot_app;
GRANT SELECT, INSERT ON public.payslip_line_items TO paypilot_app;
