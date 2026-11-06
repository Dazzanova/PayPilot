# Archived Supabase-era migrations

These migrations were written for the original Supabase-hosted database. They
are retained here as historical record but are **not** part of the active
Prisma migration path.

They are intentionally excluded from `prisma/migrations` because they assume
Supabase-specific conventions that are invalid on the independently managed
PostgreSQL instance:

- `app.current_organization_id` was cast to `uuid`, while PayPilot stores
  identifiers as `TEXT` UUID strings.
- They create RLS policies that assume Supabase's service role and
  `BYPASSRLS` behavior.

The active migration history starts with
`20261014000000_baseline_schema`, which captures the schema from
`prisma/schema.prisma`, followed by the Keycloak identity and native PostgreSQL
RLS migrations.

Existing Supabase databases that already applied these migrations can adopt the
native history by marking the baseline as applied and then running the new
forward migrations:

```bash
npx prisma migrate resolve --applied 20261014000000_baseline_schema
npm run db:migrate
```

Do not copy these files back into `prisma/migrations`.
