# Native PostgreSQL Row-Level Security (RLS)

PayPilot enforces tenant isolation inside PostgreSQL. The application layer still scopes queries, but RLS is the final boundary: even a bug in a route or service cannot read or mutate another tenant's rows.

## 1. Goals

- Deny cross-tenant reads and writes at the database level.
- Deny access when tenant context is missing or invalid.
- Prevent the runtime role from bypassing policies.
- Keep migrations and controlled provisioning functional.
- Allow identity resolution before tenant context exists without exposing profile data.
- Avoid per-query application filtering as the only isolation mechanism.

## 2. Roles

The Docker init script creates three PayPilot-related roles:

| Role | Purpose | Properties |
|---|---|---|
| `paypilot_migrator` | Owns the schema and tables; runs migrations and provisioning | `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEROLE` |
| `paypilot_app` | API runtime role | `NOSUPERUSER`, `NOBYPASSRLS`, does not own tables |
| `keycloak` | Keycloak database only | Separate database and credentials |

The API's `DATABASE_URL` uses `paypilot_app`. Prisma CLI migrations and `scripts/provision-dev-user.ts` use `DIRECT_URL` with `paypilot_migrator`.

The runtime role cannot assume the migrator role:

```sql
SET ROLE paypilot_migrator; -- permission denied for paypilot_app
```

RLS is enabled **and forced** on all tenant-owned tables. `FORCE ROW LEVEL SECURITY` means even the table owner is subject to policies. The migrator therefore receives explicit permissive policies so migrations and provisioning continue to work.

## 3. Tenant Context

The application sets tenant context inside a Prisma interactive transaction:

```ts
await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`
    SELECT set_config('app.current_organization_id', ${organizationId}, true)
  `;

  return callback(tx);
});
```

The `true` argument makes the setting **transaction-local**. It is set on the same connection that executes the callback and is cleared when the transaction commits or rolls back. Pooled connection reuse cannot leak tenant context between requests.

The policy helper reads the setting and returns `NULL` when it is absent:

```sql
CREATE OR REPLACE FUNCTION public.paypilot_current_organization_id()
RETURNS text
LANGUAGE sql
STABLE
AS $function$
  SELECT NULLIF(current_setting('app.current_organization_id', true), '')
$function$;
```

Because PayPilot stores UUIDs as `TEXT`, the helper returns `TEXT`. Comparing it directly to `organization_id` avoids type-cast surprises and matches the Prisma schema.

`src/lib/tenant.ts` exposes `withOrganizationContext(organizationId, callback)` and rejects an empty organization ID before opening a transaction.

## 4. Policies

Policies are scoped to the runtime role:

```sql
CREATE POLICY departments_app_select ON public.departments
  FOR SELECT TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());
```

All tenant-owned tables follow the same pattern:

- `departments`
- `employees`
- `attendance_records`
- `leave_requests`
- `payroll_runs`
- `payslips`
- `users`
- `organizations`
- `audit_logs`

### Per-table behavior

| Table | Runtime behavior |
|---|---|
| `organizations` | Read only the current organization. Inserts/updates/deletes are not granted to the runtime role. |
| `users` | Read/update/delete only within the current organization. The runtime role cannot insert users. |
| `departments`, `employees`, `attendance_records`, `leave_requests`, `payroll_runs`, `payslips` | Full CRUD restricted to the current organization. |
| `audit_logs` | Select and insert only within the current organization. Update/delete policies do not exist, so they are denied. |

### Migrator policies

Every protected table also has a permissive `*_migrator_all` policy for `paypilot_migrator`:

```sql
CREATE POLICY users_migrator_all ON public.users
  FOR ALL TO paypilot_migrator
  USING (true)
  WITH CHECK (true);
```

These exist only because `FORCE ROW LEVEL SECURITY` applies to the owner. The runtime role never has this privilege.

### Missing context

If `app.current_organization_id` is unset or empty, `paypilot_current_organization_id()` returns `NULL`. Comparisons such as `organization_id = NULL` are not true, so:

- `SELECT` returns zero rows.
- `INSERT` and `UPDATE` fail the `WITH CHECK`.
- `DELETE` matches zero rows.

This is fail-closed behavior.

## 5. Identity Resolution Before Tenant Context

Authentication needs to find the user before the organization is known. That single lookup uses a narrowly scoped `SECURITY DEFINER` function:

```sql
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
```

Properties:

- Exact match on `(identity_issuer, identity_subject)` only.
- No email matching and no fuzzy fallback.
- Returns only `user_id` and `organization_id`; no email, role, or profile fields.
- Execute is revoked from `PUBLIC` and granted only to `paypilot_app`.
- `search_path` is fixed to prevent object-shadowing attacks.
- Once the organization ID is known, the API opens a tenant-scoped transaction to load the profile and update `lastLoginAt`.

## 6. Migration History

Active migrations:

```text
20261014000000_baseline_schema
20261106090000_keycloak_identity_mapping
20261106090100_native_postgres_rls
```

The RLS migration:

1. Drops the Supabase-era context functions and every old policy name.
2. Creates `paypilot_current_organization_id()` and `paypilot_resolve_identity(text, text)`.
3. Enables and forces RLS on every tenant-owned table.
4. Creates tenant policies for `paypilot_app`.
5. Creates explicit permissive policies for `paypilot_migrator`.
6. Grants runtime DML privileges and sets default privileges for future tables.

Supabase-era migrations are archived under `prisma/migrations-legacy-supabase/`. They are retained as history but are not executed against native PostgreSQL because their `uuid` casts and Supabase role assumptions are invalid for this schema.

Existing databases that already applied the legacy migrations should mark the baseline as applied once:

```bash
npx prisma migrate resolve --applied 20261014000000_baseline_schema
npm run db:migrate
```

## 7. Testing

The real-database suite is `apps/api/src/middleware/rls.test.ts`. It is gated by `RUN_DB_INTEGRATION=1` and connects as `paypilot_app` for runtime assertions, with a separate `paypilot_migrator` client only for setup and cleanup.

```bash
npm run test:integration
```

Coverage includes:

- Runtime role is not a superuser, does not bypass RLS, and does not own tables.
- Runtime role cannot `SET ROLE paypilot_migrator`.
- Missing context denies reads and writes.
- Cross-tenant select, insert, update, and delete are denied.
- A tenant can create, read, update, and delete its own rows.
- Sequential and concurrent transactions do not leak context.
- Failed transactions roll back data and leave no ambient context.
- Identity resolution matches exact issuer/subject pairs and ignores email.
- Users are hidden without context and from other tenants.
- Duplicate identity mappings are rejected.
- Organization records are read-only to tenants.
- Audit logs are append-only.

`apps/api/src/middleware/auth.integration.test.ts` additionally covers active, inactive, unlinked, and unknown-issuer identities through the real database.

## 8. Operational Rules

- Never connect application code as `paypilot_migrator` or the PostgreSQL bootstrap superuser.
- Never add `BYPASSRLS` to `paypilot_app`.
- Never run application queries outside tenant context unless they go through the identity function.
- Never use `prisma db push`; policies and grants live in migrations.
- Add new tenant-owned tables to the RLS migration pattern (enable, force, tenant policy, migrator policy, grants).
- Keep `identityIssuer` and `identitySubject` written only by controlled provisioning or an audited admin flow.
- Re-run `npm run test:integration` after any schema or policy change.

## 9. Known Limitations

- Local development uses direct connections. Production should use a pooled runtime connection while keeping a direct session for migrations.
- The baseline assumes a fresh native PostgreSQL database. Upgrading an existing Supabase database requires the baseline resolve step and a rehearsal on a restored copy.
- Role creation is handled by the Docker init script, not by Prisma migrations, because roles are cluster-level objects and must exist before the first migration.
- The provisioning script is development-only and refuses to run with `NODE_ENV=production`.
