-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "esi_applicable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "pf_applicable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "state" VARCHAR(2);

-- CreateTable
CREATE TABLE "payroll_statutory_settings" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "standard_deduction_cents" INTEGER NOT NULL,
    "rebate_threshold_cents" INTEGER NOT NULL,
    "rebate_max_cents" INTEGER NOT NULL,
    "cess_rate_bps" INTEGER NOT NULL,
    "pf_employee_rate_bps" INTEGER NOT NULL,
    "pf_wage_ceiling_cents" INTEGER NOT NULL,
    "esi_employee_rate_bps" INTEGER NOT NULL,
    "esi_gross_ceiling_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_statutory_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_tax_slab_sets" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_tax_slab_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_tax_slabs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "set_id" TEXT NOT NULL,
    "lower_cents" INTEGER NOT NULL,
    "upper_cents" INTEGER,
    "rate_bps" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_tax_slabs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_professional_tax_slab_sets" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "state" VARCHAR(2) NOT NULL,
    "effective_from" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_professional_tax_slab_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_professional_tax_slabs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "set_id" TEXT NOT NULL,
    "lower_cents" INTEGER NOT NULL,
    "upper_cents" INTEGER,
    "amount_cents" INTEGER NOT NULL,
    "february_amount_cents" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_professional_tax_slabs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_statutory_settings_organization_id_effective_from_idx" ON "payroll_statutory_settings"("organization_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_statutory_settings_organization_id_effective_from_key" ON "payroll_statutory_settings"("organization_id", "effective_from");

-- CreateIndex
CREATE INDEX "payroll_tax_slab_sets_organization_id_effective_from_idx" ON "payroll_tax_slab_sets"("organization_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_tax_slab_sets_organization_id_effective_from_key" ON "payroll_tax_slab_sets"("organization_id", "effective_from");

-- CreateIndex
CREATE INDEX "payroll_tax_slabs_organization_id_set_id_idx" ON "payroll_tax_slabs"("organization_id", "set_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_tax_slabs_set_id_lower_cents_key" ON "payroll_tax_slabs"("set_id", "lower_cents");

-- CreateIndex
CREATE INDEX "payroll_professional_tax_slab_sets_organization_id_state_ef_idx" ON "payroll_professional_tax_slab_sets"("organization_id", "state", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_professional_tax_slab_sets_organization_id_state_ef_key" ON "payroll_professional_tax_slab_sets"("organization_id", "state", "effective_from");

-- CreateIndex
CREATE INDEX "payroll_professional_tax_slabs_organization_id_set_id_idx" ON "payroll_professional_tax_slabs"("organization_id", "set_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_professional_tax_slabs_set_id_lower_cents_key" ON "payroll_professional_tax_slabs"("set_id", "lower_cents");

-- AddForeignKey
ALTER TABLE "payroll_statutory_settings" ADD CONSTRAINT "payroll_statutory_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_tax_slab_sets" ADD CONSTRAINT "payroll_tax_slab_sets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_tax_slabs" ADD CONSTRAINT "payroll_tax_slabs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_tax_slabs" ADD CONSTRAINT "payroll_tax_slabs_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "payroll_tax_slab_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_professional_tax_slab_sets" ADD CONSTRAINT "payroll_professional_tax_slab_sets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_professional_tax_slabs" ADD CONSTRAINT "payroll_professional_tax_slabs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_professional_tax_slabs" ADD CONSTRAINT "payroll_professional_tax_slabs_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "payroll_professional_tax_slab_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------

ALTER TABLE public.payroll_statutory_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_statutory_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_tax_slab_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_tax_slab_sets FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_tax_slabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_tax_slabs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_professional_tax_slab_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_professional_tax_slab_sets FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_professional_tax_slabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_professional_tax_slabs FORCE ROW LEVEL SECURITY;

CREATE POLICY payroll_statutory_settings_app_select ON public.payroll_statutory_settings
  FOR SELECT TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());
CREATE POLICY payroll_statutory_settings_app_insert ON public.payroll_statutory_settings
  FOR INSERT TO paypilot_app
  WITH CHECK (organization_id = public.paypilot_current_organization_id());
CREATE POLICY payroll_statutory_settings_app_update ON public.payroll_statutory_settings
  FOR UPDATE TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id())
  WITH CHECK (organization_id = public.paypilot_current_organization_id());

CREATE POLICY payroll_tax_slab_sets_app_select ON public.payroll_tax_slab_sets
  FOR SELECT TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());
CREATE POLICY payroll_tax_slab_sets_app_insert ON public.payroll_tax_slab_sets
  FOR INSERT TO paypilot_app
  WITH CHECK (organization_id = public.paypilot_current_organization_id());
CREATE POLICY payroll_tax_slab_sets_app_update ON public.payroll_tax_slab_sets
  FOR UPDATE TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id())
  WITH CHECK (organization_id = public.paypilot_current_organization_id());
CREATE POLICY payroll_tax_slab_sets_app_delete ON public.payroll_tax_slab_sets
  FOR DELETE TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());

CREATE POLICY payroll_tax_slabs_app_select ON public.payroll_tax_slabs
  FOR SELECT TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());
CREATE POLICY payroll_tax_slabs_app_insert ON public.payroll_tax_slabs
  FOR INSERT TO paypilot_app
  WITH CHECK (organization_id = public.paypilot_current_organization_id());
CREATE POLICY payroll_tax_slabs_app_delete ON public.payroll_tax_slabs
  FOR DELETE TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());

CREATE POLICY payroll_professional_tax_slab_sets_app_select ON public.payroll_professional_tax_slab_sets
  FOR SELECT TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());
CREATE POLICY payroll_professional_tax_slab_sets_app_insert ON public.payroll_professional_tax_slab_sets
  FOR INSERT TO paypilot_app
  WITH CHECK (organization_id = public.paypilot_current_organization_id());
CREATE POLICY payroll_professional_tax_slab_sets_app_update ON public.payroll_professional_tax_slab_sets
  FOR UPDATE TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id())
  WITH CHECK (organization_id = public.paypilot_current_organization_id());
CREATE POLICY payroll_professional_tax_slab_sets_app_delete ON public.payroll_professional_tax_slab_sets
  FOR DELETE TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());

CREATE POLICY payroll_professional_tax_slabs_app_select ON public.payroll_professional_tax_slabs
  FOR SELECT TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());
CREATE POLICY payroll_professional_tax_slabs_app_insert ON public.payroll_professional_tax_slabs
  FOR INSERT TO paypilot_app
  WITH CHECK (organization_id = public.paypilot_current_organization_id());
CREATE POLICY payroll_professional_tax_slabs_app_delete ON public.payroll_professional_tax_slabs
  FOR DELETE TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());

CREATE POLICY payroll_statutory_settings_migrator_all ON public.payroll_statutory_settings
  FOR ALL TO paypilot_migrator USING (true) WITH CHECK (true);
CREATE POLICY payroll_tax_slab_sets_migrator_all ON public.payroll_tax_slab_sets
  FOR ALL TO paypilot_migrator USING (true) WITH CHECK (true);
CREATE POLICY payroll_tax_slabs_migrator_all ON public.payroll_tax_slabs
  FOR ALL TO paypilot_migrator USING (true) WITH CHECK (true);
CREATE POLICY payroll_professional_tax_slab_sets_migrator_all ON public.payroll_professional_tax_slab_sets
  FOR ALL TO paypilot_migrator USING (true) WITH CHECK (true);
CREATE POLICY payroll_professional_tax_slabs_migrator_all ON public.payroll_professional_tax_slabs
  FOR ALL TO paypilot_migrator USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.payroll_statutory_settings TO paypilot_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_tax_slab_sets TO paypilot_app;
GRANT SELECT, INSERT, DELETE ON public.payroll_tax_slabs TO paypilot_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_professional_tax_slab_sets TO paypilot_app;
GRANT SELECT, INSERT, DELETE ON public.payroll_professional_tax_slabs TO paypilot_app;

-- ---------------------------------------------------------------------------
-- Seed India new-regime configuration (effective 2025-04-01) for every tenant.
-- Values are last-known FY 2025-26 figures and remain editable through the API.
-- ---------------------------------------------------------------------------

INSERT INTO public.payroll_statutory_settings (
  id, organization_id, effective_from,
  standard_deduction_cents, rebate_threshold_cents, rebate_max_cents,
  cess_rate_bps, pf_employee_rate_bps, pf_wage_ceiling_cents,
  esi_employee_rate_bps, esi_gross_ceiling_cents,
  created_at, updated_at
)
SELECT
  gen_random_uuid()::text, o.id, DATE '2025-04-01',
  7500000, 120000000, 6000000,
  400, 1200, 1500000,
  75, 2100000,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM public.organizations o;

INSERT INTO public.payroll_tax_slab_sets (id, organization_id, effective_from, created_at, updated_at)
SELECT gen_random_uuid()::text, o.id, DATE '2025-04-01', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM public.organizations o;

INSERT INTO public.payroll_tax_slabs (id, organization_id, set_id, lower_cents, upper_cents, rate_bps, created_at)
SELECT gen_random_uuid()::text, s.organization_id, s.id, v.lower_cents, v.upper_cents, v.rate_bps, CURRENT_TIMESTAMP
FROM public.payroll_tax_slab_sets s
CROSS JOIN (VALUES
  (0, 40000000, 0),
  (40000000, 80000000, 500),
  (80000000, 120000000, 1000),
  (120000000, 160000000, 1500),
  (160000000, 200000000, 2000),
  (200000000, 240000000, 2500),
  (240000000, NULL, 3000)
) AS v(lower_cents, upper_cents, rate_bps);

INSERT INTO public.payroll_professional_tax_slab_sets (
  id, organization_id, state, effective_from, created_at, updated_at
)
SELECT gen_random_uuid()::text, o.id, st.state, DATE '2025-04-01', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM public.organizations o
CROSS JOIN (VALUES ('MH'), ('KA')) AS st(state);

INSERT INTO public.payroll_professional_tax_slabs (
  id, organization_id, set_id, lower_cents, upper_cents, amount_cents, february_amount_cents, created_at
)
SELECT gen_random_uuid()::text, s.organization_id, s.id,
  v.lower_cents, v.upper_cents, v.amount_cents, v.february_amount_cents, CURRENT_TIMESTAMP
FROM public.payroll_professional_tax_slab_sets s
JOIN (VALUES
  ('MH', 0, 750000, 0, 0),
  ('MH', 750000, 1000000, 17500, 17500),
  ('MH', 1000000, NULL, 20000, 30000),
  ('KA', 0, 1500000, 0, 0),
  ('KA', 1500000, NULL, 20000, 20000)
) AS v(state, lower_cents, upper_cents, amount_cents, february_amount_cents)
  ON v.state = s.state;

-- Legacy defaults would double-deduct once PF/TDS are computed. Only exact
-- matches for INR organizations are deactivated.
UPDATE public.payroll_deduction_rules r
SET active = false, updated_at = CURRENT_TIMESTAMP
FROM public.organizations o
WHERE o.id = r.organization_id
  AND o.currency = 'INR'
  AND (
    (r.name = 'Income tax' AND r.type = 'RATE' AND r.value = 10.00)
    OR (r.name = 'Pension' AND r.type = 'RATE' AND r.value = 5.00)
  );
