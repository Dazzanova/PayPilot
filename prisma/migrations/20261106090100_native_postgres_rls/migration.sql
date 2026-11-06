-- Replace the Supabase-era RLS policies with native PostgreSQL policies.
-- The runtime role (paypilot_app) never owns these tables and cannot bypass RLS.
-- The migration/provisioning role (paypilot_migrator) owns the tables and has
-- an explicit permissive policy so migrations and controlled provisioning work.

DROP FUNCTION IF EXISTS public.set_app_context(uuid);
DROP FUNCTION IF EXISTS public.get_app_context();

CREATE OR REPLACE FUNCTION public.paypilot_current_organization_id()
RETURNS text
LANGUAGE sql
STABLE
AS $function$
  SELECT NULLIF(current_setting('app.current_organization_id', true), '')
$function$;

REVOKE ALL ON FUNCTION public.paypilot_current_organization_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.paypilot_current_organization_id() TO paypilot_app;

-- Drop every policy created by the previous migrations, including the
-- unrestricted policies that allowed cross-tenant reads.
DROP POLICY IF EXISTS departments_select ON public.departments;
DROP POLICY IF EXISTS departments_insert ON public.departments;
DROP POLICY IF EXISTS departments_update ON public.departments;
DROP POLICY IF EXISTS departments_delete ON public.departments;

DROP POLICY IF EXISTS employees_select ON public.employees;
DROP POLICY IF EXISTS employees_insert ON public.employees;
DROP POLICY IF EXISTS employees_update ON public.employees;
DROP POLICY IF EXISTS employees_delete ON public.employees;

DROP POLICY IF EXISTS attendance_records_select ON public.attendance_records;
DROP POLICY IF EXISTS attendance_records_insert ON public.attendance_records;
DROP POLICY IF EXISTS attendance_records_update ON public.attendance_records;
DROP POLICY IF EXISTS attendance_records_delete ON public.attendance_records;

DROP POLICY IF EXISTS leave_requests_select ON public.leave_requests;
DROP POLICY IF EXISTS leave_requests_insert ON public.leave_requests;
DROP POLICY IF EXISTS leave_requests_update ON public.leave_requests;
DROP POLICY IF EXISTS leave_requests_delete ON public.leave_requests;

DROP POLICY IF EXISTS payroll_runs_select ON public.payroll_runs;
DROP POLICY IF EXISTS payroll_runs_insert ON public.payroll_runs;
DROP POLICY IF EXISTS payroll_runs_update ON public.payroll_runs;
DROP POLICY IF EXISTS payroll_runs_delete ON public.payroll_runs;

DROP POLICY IF EXISTS payslips_select ON public.payslips;
DROP POLICY IF EXISTS payslips_insert ON public.payslips;
DROP POLICY IF EXISTS payslips_update ON public.payslips;
DROP POLICY IF EXISTS payslips_delete ON public.payslips;

DROP POLICY IF EXISTS audit_logs_select ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_insert ON public.audit_logs;

DROP POLICY IF EXISTS users_select ON public.users;
DROP POLICY IF EXISTS users_insert ON public.users;
DROP POLICY IF EXISTS users_update ON public.users;
DROP POLICY IF EXISTS users_delete ON public.users;

DROP POLICY IF EXISTS organizations_select ON public.organizations;
DROP POLICY IF EXISTS organizations_insert ON public.organizations;
DROP POLICY IF EXISTS organizations_update ON public.organizations;
DROP POLICY IF EXISTS organizations_delete ON public.organizations;
DROP POLICY IF EXISTS organizations_all ON public.organizations;

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees FORCE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records FORCE ROW LEVEL SECURITY;
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payslips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payslips FORCE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;

-- Organizations: a tenant can read only its own organization record.
CREATE POLICY organizations_app_select ON public.organizations
  FOR SELECT TO paypilot_app
  USING (id = public.paypilot_current_organization_id());

-- Users: tenant-scoped reads and writes. App code cannot insert users; that is
-- performed by the migrator role through the controlled provisioning script.
CREATE POLICY users_app_select ON public.users
  FOR SELECT TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());
CREATE POLICY users_app_update ON public.users
  FOR UPDATE TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id())
  WITH CHECK (organization_id = public.paypilot_current_organization_id());
CREATE POLICY users_app_delete ON public.users
  FOR DELETE TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());

-- Departments
CREATE POLICY departments_app_select ON public.departments
  FOR SELECT TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());
CREATE POLICY departments_app_insert ON public.departments
  FOR INSERT TO paypilot_app
  WITH CHECK (organization_id = public.paypilot_current_organization_id());
CREATE POLICY departments_app_update ON public.departments
  FOR UPDATE TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id())
  WITH CHECK (organization_id = public.paypilot_current_organization_id());
CREATE POLICY departments_app_delete ON public.departments
  FOR DELETE TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());

-- Employees
CREATE POLICY employees_app_select ON public.employees
  FOR SELECT TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());
CREATE POLICY employees_app_insert ON public.employees
  FOR INSERT TO paypilot_app
  WITH CHECK (organization_id = public.paypilot_current_organization_id());
CREATE POLICY employees_app_update ON public.employees
  FOR UPDATE TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id())
  WITH CHECK (organization_id = public.paypilot_current_organization_id());
CREATE POLICY employees_app_delete ON public.employees
  FOR DELETE TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());

-- Attendance records
CREATE POLICY attendance_records_app_select ON public.attendance_records
  FOR SELECT TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());
CREATE POLICY attendance_records_app_insert ON public.attendance_records
  FOR INSERT TO paypilot_app
  WITH CHECK (organization_id = public.paypilot_current_organization_id());
CREATE POLICY attendance_records_app_update ON public.attendance_records
  FOR UPDATE TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id())
  WITH CHECK (organization_id = public.paypilot_current_organization_id());
CREATE POLICY attendance_records_app_delete ON public.attendance_records
  FOR DELETE TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());

-- Leave requests
CREATE POLICY leave_requests_app_select ON public.leave_requests
  FOR SELECT TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());
CREATE POLICY leave_requests_app_insert ON public.leave_requests
  FOR INSERT TO paypilot_app
  WITH CHECK (organization_id = public.paypilot_current_organization_id());
CREATE POLICY leave_requests_app_update ON public.leave_requests
  FOR UPDATE TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id())
  WITH CHECK (organization_id = public.paypilot_current_organization_id());
CREATE POLICY leave_requests_app_delete ON public.leave_requests
  FOR DELETE TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());

-- Payroll runs
CREATE POLICY payroll_runs_app_select ON public.payroll_runs
  FOR SELECT TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());
CREATE POLICY payroll_runs_app_insert ON public.payroll_runs
  FOR INSERT TO paypilot_app
  WITH CHECK (organization_id = public.paypilot_current_organization_id());
CREATE POLICY payroll_runs_app_update ON public.payroll_runs
  FOR UPDATE TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id())
  WITH CHECK (organization_id = public.paypilot_current_organization_id());
CREATE POLICY payroll_runs_app_delete ON public.payroll_runs
  FOR DELETE TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());

-- Payslips
CREATE POLICY payslips_app_select ON public.payslips
  FOR SELECT TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());
CREATE POLICY payslips_app_insert ON public.payslips
  FOR INSERT TO paypilot_app
  WITH CHECK (organization_id = public.paypilot_current_organization_id());
CREATE POLICY payslips_app_update ON public.payslips
  FOR UPDATE TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id())
  WITH CHECK (organization_id = public.paypilot_current_organization_id());
CREATE POLICY payslips_app_delete ON public.payslips
  FOR DELETE TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());

-- Audit logs are append-only.
CREATE POLICY audit_logs_app_select ON public.audit_logs
  FOR SELECT TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());
CREATE POLICY audit_logs_app_insert ON public.audit_logs
  FOR INSERT TO paypilot_app
  WITH CHECK (organization_id = public.paypilot_current_organization_id());

-- The migrator owns the tables, so FORCE RLS applies to it as well. This
-- explicit policy keeps migrations and controlled provisioning functional.
CREATE POLICY organizations_migrator_all ON public.organizations
  FOR ALL TO paypilot_migrator USING (true) WITH CHECK (true);
CREATE POLICY users_migrator_all ON public.users
  FOR ALL TO paypilot_migrator USING (true) WITH CHECK (true);
CREATE POLICY departments_migrator_all ON public.departments
  FOR ALL TO paypilot_migrator USING (true) WITH CHECK (true);
CREATE POLICY employees_migrator_all ON public.employees
  FOR ALL TO paypilot_migrator USING (true) WITH CHECK (true);
CREATE POLICY attendance_records_migrator_all ON public.attendance_records
  FOR ALL TO paypilot_migrator USING (true) WITH CHECK (true);
CREATE POLICY leave_requests_migrator_all ON public.leave_requests
  FOR ALL TO paypilot_migrator USING (true) WITH CHECK (true);
CREATE POLICY payroll_runs_migrator_all ON public.payroll_runs
  FOR ALL TO paypilot_migrator USING (true) WITH CHECK (true);
CREATE POLICY payslips_migrator_all ON public.payslips
  FOR ALL TO paypilot_migrator USING (true) WITH CHECK (true);
CREATE POLICY audit_logs_migrator_all ON public.audit_logs
  FOR ALL TO paypilot_migrator USING (true) WITH CHECK (true);

-- Narrow, SECURITY DEFINER identity lookup for authentication. This runs before
-- tenant context exists and returns only the internal user and organization
-- identifiers for an exact (issuer, subject) match.
CREATE OR REPLACE FUNCTION public.paypilot_resolve_identity(
  p_issuer text,
  p_subject text
)
RETURNS TABLE (user_id text, organization_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT u.id, u.organization_id
  FROM public.users AS u
  WHERE u.identity_issuer = p_issuer
    AND u.identity_subject = p_subject
  LIMIT 1
$function$;

REVOKE ALL ON FUNCTION public.paypilot_resolve_identity(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.paypilot_resolve_identity(text, text) TO paypilot_app;

-- Runtime privileges: data access only. The runtime role is not the table owner
-- and has no BYPASSRLS attribute.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO paypilot_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO paypilot_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO paypilot_app;

ALTER DEFAULT PRIVILEGES FOR ROLE paypilot_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO paypilot_app;
ALTER DEFAULT PRIVILEGES FOR ROLE paypilot_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO paypilot_app;
