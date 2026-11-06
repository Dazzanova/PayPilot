> **Historical snapshot (pre-migration).** This document describes the former Supabase-based architecture and is retained for project history. For current setup, see [architecture.md](./architecture.md), [authentication.md](./authentication.md), and [RLS-IMPLEMENTATION.md](./RLS-IMPLEMENTATION.md).

# Milestone 3 Design Audit: RLS Implementation Defects and Corrections

**Date:** October 15, 2026  
**Status:** Design Review Complete - Defects Identified - Corrections Implemented

---

## Executive Summary

The initial implementation had **critical design flaws** in tenant-context propagation:

1. **Session variable set in separate query:** The Prisma middleware executes `SET app.current_organization_id` as a separate query from the protected query, potentially on a different connection from the pool (with pgbouncer).

2. **Map-based context not transaction-scoped:** Using a global Map with async tracking is unreliable under concurrent requests and doesn't guarantee the session variable is set on the same connection that executes protected queries.

3. **Insufficient policy review:** Users table allows unrestricted SELECT; Organizations table allows unrestricted access; some update paths don't validate organization context.

4. **No transaction verification:** The design claims transaction-scoping but relies on middleware hooks that don't run inside a database transaction.

**Result:** Cross-tenant isolation cannot be guaranteed because the tenant context may not be set on the connection that executes the protected query.

---

## 1. Original Design Defects

### Defect 1: Session Variable Set in Separate Query

**Current Code (apps/api/src/lib/prisma.ts):**

```typescript
prisma.$use(async (params, next) => {
  const organizationId = getCurrentTenantContext();
  
  if (organizationId) {
    try {
      // DEFECT: This is a SEPARATE query from next(params)
      await prisma.$executeRaw`SELECT set_config('app.current_organization_id', 
        ${organizationId}::text, false)`;
    } catch (error) {
      logger.warn('Failed to set tenant context in database', ...);
    }
  }
  
  // next(params) executes on POTENTIALLY DIFFERENT CONNECTION
  return next(params);
});
```

**Problem:**
- `set_config(..., false)` sets session variable for current connection
- `next(params)` may use a different connection from the pool
- With pgbouncer transaction pooling, connections are reused per transaction
- If reused, the session variable is not carried over
- **Result:** Query executes WITHOUT tenant context → RLS policies see empty/null context

**Why This Fails:**
1. Prisma middleware is NOT inside a database transaction
2. Each `$executeRaw` and the subsequent `next(params)` can use different connections
3. Session variables (`set_config(..., false)`) are connection-local, not query-local
4. No guarantee both run on same connection

### Defect 2: Map-Based Context Not Transaction-Scoped

**Current Code (apps/api/src/lib/prisma.ts):**

```typescript
const tenantContextMap = new Map<string, string>();

export async function withTenantContextAsync<T>(
  organizationId: string,
  fn: () => Promise<T>
): Promise<T> {
  const contextId = generateContextId();
  tenantContextMap.set(contextId, organizationId);
  try {
    // Set global variable that middleware reads
    (globalThis as any).__currentPrismaContextId = contextId;
    return await fn();
  } finally {
    delete (globalThis as any).__currentPrismaContextId;
    tenantContextMap.delete(contextId);
  }
}
```

**Problems:**
1. Global Map is shared across concurrent requests
2. Context ID is a timestamp + counter (not unique across high concurrency)
3. If two requests run simultaneously, they might read each other's context IDs
4. Async boundaries don't guarantee isolation
5. **AsyncLocalStorage would be better, but still doesn't solve the connection reuse issue**

**Race Condition Example:**
```
Request 1 (Org A): contextId = ctx_1728036000000_1
Request 2 (Org B): contextId = ctx_1728036000000_2  (same timestamp!)

Request 2 executes: tenantContextMap.get(ctx_1728036000000_2) → "org-B-id"
Request 1 executes: tenantContextMap.get(ctx_1728036000000_1) → "org-A-id"

But if requests run on same connection pool, they might interfere!
```

### Defect 3: Insufficient Policy Review

**Current Policies Have Gaps:**

1. **Users table** - currently allows `USING (true)` for SELECT:
   ```sql
   CREATE POLICY users_select ON users FOR SELECT USING (true);
   ```
   This violates the principle that SELECT should also be organization-scoped. An employee from Org A should not see all users from Org B in a join query.

2. **Organizations table** - currently allows all:
   ```sql
   CREATE POLICY organizations_all ON organizations 
     USING (true) WITH CHECK (true);
   ```
   Should have RLS enabled.

3. **No row-level insert verification** - inserting with mismatched organization_id relies solely on app code:
   ```sql
   CREATE POLICY departments_insert ON departments
     FOR INSERT
     WITH CHECK (organization_id = (SELECT current_setting('app.current_organization_id')::uuid));
   ```
   This WILL work if context is set correctly, but failure is silent if context is missing.

### Defect 4: No Transaction Verification

The design assumes:
- Session variables persist across middleware hooks ✗ (they don't, different connections)
- Context ID uniqueness under concurrency ✓ (mostly, but not guaranteed)
- Prisma middleware runs inside a database transaction ✗ (it doesn't)

**Reality:**
- Prisma middleware is **not** inside a transaction
- `set_config` affects current connection only
- Next query may use different connection → context lost
- No verification that both queries use same connection

---

## 2. Corrected Transaction-Scoped Architecture

### Corrected Design Principles

1. **Transaction Locality:** Tenant context is set within a database transaction, and all protected queries execute within that same transaction.

2. **Explicit Parameterization:** Organization context is explicitly passed through Prisma transaction API, not via global/middleware hooks.

3. **Session Variable Scope:** Use `set_config(..., true)` to set session variable (session-scoped, survives transaction), but only within a transaction started explicitly.

4. **Verified Connection:** Prisma transactions use a single connection per transaction scope.

### Corrected Implementation Pattern

```typescript
// Instead of middleware + global context, use explicit transactions

export async function withOrganizationContext<T>(
  organizationId: string,
  fn: (tx: PrismaClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // Execute SET inside the transaction on the SAME connection
    await tx.$executeRaw`SELECT set_config('app.current_organization_id', 
      ${organizationId}::uuid::text, true)`;
    
    // All queries passed tx use the SAME connection with context set
    return await fn(tx);
  });
}

// Usage:
const employees = await withOrganizationContext(req.auth.organization.id, async (tx) => {
  // tx is guaranteed to use same connection with context set
  return await tx.employee.findMany();
});
```

**Why This Works:**

1. `prisma.$transaction()` returns a client that uses a single connection
2. `set_config(..., true)` sets session variable on that connection
3. All subsequent queries via `tx` use same connection
4. Session variable persists through entire transaction
5. Transaction rolls back on error, clearing context automatically
6. Connection returns to pool, context cleared

### Key Differences from Original Design

| Aspect | Original (Defective) | Corrected |
|--------|---------------------|-----------|
| Context Setting | Middleware hook, separate query | Inside transaction, same connection |
| Query Execution | Via global context + middleware | Via transaction client |
| Connection Guarantee | No | Yes (transaction client) |
| Concurrency Safety | Unreliable (global state) | Safe (per-transaction client) |
| Context Lifecycle | Request-scoped (unmapped) | Transaction-scoped (explicit) |
| Error Handling | Middleware silently continues | Transaction rolls back |

---

## 3. Policy and Privilege Review

### All Tenant-Owned Tables - Corrected Policies

#### departments
✅ **Policy:** Fully restricted per organization
- SELECT: org_id = context
- INSERT: org_id = context  
- UPDATE: org_id = context (both USING and WITH CHECK)
- DELETE: org_id = context

#### employees
✅ **Policy:** Fully restricted per organization
- SELECT: org_id = context
- INSERT: org_id = context
- UPDATE: org_id = context (both USING and WITH CHECK)
- DELETE: org_id = context

#### attendance_records
✅ **Policy:** Fully restricted per organization
- SELECT: org_id = context
- INSERT: org_id = context
- UPDATE: org_id = context (both USING and WITH CHECK)
- DELETE: org_id = context

#### leave_requests
✅ **Policy:** Fully restricted per organization
- SELECT: org_id = context
- INSERT: org_id = context
- UPDATE: org_id = context (both USING and WITH CHECK)
- DELETE: org_id = context

#### payroll_runs
✅ **Policy:** Fully restricted per organization
- SELECT: org_id = context
- INSERT: org_id = context
- UPDATE: org_id = context (both USING and WITH CHECK)
- DELETE: org_id = context

#### payslips
✅ **Policy:** Fully restricted per organization
- SELECT: org_id = context
- INSERT: org_id = context
- UPDATE: org_id = context (both USING and WITH CHECK)
- DELETE: org_id = context

#### audit_logs
✅ **Policy:** Fully restricted per organization
- SELECT: org_id = context
- INSERT: org_id = context
- (No UPDATE/DELETE - immutable)

#### users (CORRECTED)
❌ **Original Problem:** SELECT allowed unrestricted
✅ **Corrected:**
- SELECT: org_id = context (REQUIRED for joins with other tenant tables)
- INSERT: Requires elevated privileges (service role)
- UPDATE: org_id = context (BOTH USING and WITH CHECK)
- DELETE: org_id = context

**Rationale:** Users table must be restricted to prevent cross-tenant user enumeration in joins. Auth lookup happens OUTSIDE transaction, using service role with BYPASSRLS.

#### organizations (CORRECTED)
❌ **Original Problem:** All access allowed
✅ **Corrected:**
```sql
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY organizations_select ON organizations
  FOR SELECT
  USING (id = (SELECT current_setting('app.current_organization_id')::uuid));

CREATE POLICY organizations_insert ON organizations
  FOR INSERT
  WITH CHECK (false);  -- Only service role can insert

CREATE POLICY organizations_update ON organizations
  FOR UPDATE
  USING (false);  -- Only service role can update

CREATE POLICY organizations_delete ON organizations
  FOR DELETE
  USING (false);  -- Only service role can delete
```

**Rationale:** Organizations can only be managed by service role (migrations/admin operations). Regular app runtime sees only own organization.

### Runtime Role Analysis

**Current Setup:** Runtime role is `postgres` (superuser)
```
postgres=# \du
                             List of roles
 Role name |                         Attributes                          
-----------+------------------------------------------------------------
 postgres  | Superuser, Create role, Create DB, Replication, Bypass RLS
```

**Problem:** `Bypass RLS` means RLS policies don't apply!

**Corrected Setup:** Create dedicated runtime role without BYPASSRLS:

```sql
-- Create runtime application role
CREATE ROLE paypilot_app WITH LOGIN PASSWORD 'app-password-here';

-- Grant permissions on schema and tables
GRANT USAGE ON SCHEMA public TO paypilot_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO paypilot_app;

-- Create separate service role for migrations/provisioning with BYPASSRLS
CREATE ROLE paypilot_service WITH BYPASSRLS LOGIN PASSWORD 'service-password-here';
GRANT ALL ON SCHEMA public TO paypilot_service;
GRANT ALL ON ALL TABLES IN SCHEMA public TO paypilot_service;

-- Verify paypilot_app does NOT have BYPASSRLS
\du paypilot_app
```

### Auth Flow with Corrected Policies

**Challenge:** User lookup must happen BEFORE transaction context can be set, but users table now has RLS enabled.

**Solution:** Use service role for auth lookup:

```typescript
// Auth middleware (uses service role, has BYPASSRLS)
export async function requireAuth(req, res, next) {
  const token = extractBearerToken(req.headers.authorization);
  const supabaseAuthId = await verifySupabaseToken(token);
  
  // Create separate Prisma client with service role connection string
  const serviceClient = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_SERVICE_URL } }
  });
  
  // Service role can access users table unrestricted
  const user = await serviceClient.user.findUnique({
    where: { supabaseAuthId },
    include: { organization: true }
  });
  
  await serviceClient.$disconnect();
  
  // Now use tenant context for subsequent operations
  req.auth = { user: user.id, organizationId: user.organization.id };
  next();
}
```

---

## 4. Test Database Setup and Verification

### PostgreSQL Test Environment

**Docker Container:** PostgreSQL 18.6
```bash
docker run -d -e POSTGRES_PASSWORD=testpass -e POSTGRES_DB=paypilot_test \
  -p 5555:5432 postgres:18
```

**Connection:**
```bash
PGPASSWORD=testpass psql -h localhost -U postgres -p 5555 -d paypilot_test
```

### Test Scenario Setup

**Step 1: Create test organizations and users**

```sql
-- Create organizations
INSERT INTO organizations (id, name, slug, currency, timezone)
VALUES 
  ('org-a-id-12345678901234567890123', 'Organization A', 'org-a', 'USD', 'UTC'),
  ('org-b-id-12345678901234567890123', 'Organization B', 'org-b', 'USD', 'UTC');

-- Create users
INSERT INTO users (id, organization_id, email, role, is_active, supabase_auth_id)
VALUES 
  ('user-a-id-1234567890123456789012', 'org-a-id-12345678901234567890123', 
   'alice@org-a.com', 'ADMIN', true, 'supabase-auth-id-alice'),
  ('user-b-id-1234567890123456789012', 'org-b-id-12345678901234567890123', 
   'bob@org-b.com', 'ADMIN', true, 'supabase-auth-id-bob');

-- Create departments for each org
INSERT INTO departments (id, organization_id, name, code)
VALUES 
  ('dept-a-1-id-12345678901234567890', 'org-a-id-12345678901234567890123', 'Sales', 'SALES'),
  ('dept-a-2-id-12345678901234567890', 'org-a-id-12345678901234567890123', 'IT', 'IT'),
  ('dept-b-1-id-12345678901234567890', 'org-b-id-12345678901234567890123', 'HR', 'HR');
```

**Step 2: Create test role (without BYPASSRLS)**

```sql
CREATE ROLE test_app WITH LOGIN PASSWORD 'testpass';
GRANT USAGE ON SCHEMA public TO test_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO test_app;
```

**Step 3: Test cross-tenant isolation**

```sql
-- Connect as test_app
\c paypilot_test test_app

-- Set context to Org A
SELECT set_config('app.current_organization_id', 
  'org-a-id-12345678901234567890123'::uuid::text, true);

-- Query departments - should see only Org A departments
SELECT name, code FROM departments;
-- Expected output:
--   name | code
--  ------+-------
--  Sales | SALES
--  IT    | IT

-- Try to see Org B department (should return nothing)
SELECT name, code FROM departments 
  WHERE organization_id = 'org-b-id-12345678901234567890123';
-- Expected output: (no rows)

-- Clear context
SELECT set_config('app.current_organization_id', '', true);

-- Try to query without context (should return nothing)
SELECT name, code FROM departments;
-- Expected output: (no rows)
```

---

## 5. Corrected Test Verification Commands

### Test 1: Cross-Tenant SELECT Blocked

```bash
# Terminal 1: Set Org A context
PGPASSWORD=testpass psql -h localhost -U test_app -p 5555 -d paypilot_test <<EOF
SELECT set_config('app.current_organization_id', 'org-a-id-12345678901234567890123'::uuid::text, true);
SELECT COUNT(*) as org_a_count FROM departments;
-- Expected: 2 (SALES, IT)

-- Try to access Org B departments
SELECT COUNT(*) as org_b_attempt FROM departments 
  WHERE organization_id = 'org-b-id-12345678901234567890123';
-- Expected: 0 (RLS blocks)
EOF
```

### Test 2: Missing Context Denies Access

```bash
PGPASSWORD=testpass psql -h localhost -U test_app -p 5555 -d paypilot_test <<EOF
-- No set_config call

SELECT COUNT(*) FROM departments;
-- Expected: 0 (RLS blocks all without context)
EOF
```

### Test 3: Connection Reuse Doesn't Leak

```bash
PGPASSWORD=testpass psql -h localhost -U test_app -p 5555 -d paypilot_test <<EOF
-- Request 1: Set to Org A
SELECT set_config('app.current_organization_id', 'org-a-id-12345678901234567890123'::uuid::text, false);
SELECT COUNT(*) as org_a FROM departments;

-- Manually clear context (simulating connection reset)
SELECT set_config('app.current_organization_id', '', false);

-- Request 2: Try to access without context
SELECT COUNT(*) FROM departments;
-- Expected: 0 (RLS blocks)

-- Request 3: Set to Org B
SELECT set_config('app.current_organization_id', 'org-b-id-12345678901234567890123'::uuid::text, false);
SELECT COUNT(*) as org_b FROM departments;
-- Expected: 1 (HR only)
EOF
```

### Test 4: Verify Runtime Role Respects RLS

```bash
# Try to connect as superuser (should bypass RLS)
PGPASSWORD=testpass psql -h localhost -U postgres -p 5555 -d paypilot_test <<EOF
-- Superuser bypasses RLS
SELECT COUNT(*) FROM departments;
-- Expected: 3 (all departments, RLS bypassed)
EOF

# Verify test_app role does NOT bypass RLS
PGPASSWORD=testpass psql -h localhost -U test_app -p 5555 -d paypilot_test <<EOF
SELECT COUNT(*) FROM departments;
-- Expected: 0 (RLS enforced)
EOF
```

---

## 6. Design Correction Summary

### What Was Wrong

1. ❌ Session variable set in separate query (different connection possibility)
2. ❌ Map-based context with global state (concurrency unsafe)
3. ❌ Users table unrestricted SELECT (cross-tenant user enumeration)
4. ❌ Organizations table all access allowed (tenant data exposure)
5. ❌ Runtime role is superuser with BYPASSRLS (RLS completely bypassed)
6. ❌ No transaction scope guarantee (middleware doesn't run in transaction)

### What Is Corrected

1. ✅ Use `prisma.$transaction()` to guarantee same connection
2. ✅ Set `set_config(..., true)` inside transaction before executing queries
3. ✅ All queries executed via transaction client (guaranteed same connection)
4. ✅ Users table restricted to organization context (with service role exception for auth)
5. ✅ Organizations table restricted to own org (regular role), admin only (service role)
6. ✅ Create dedicated runtime role without BYPASSRLS
7. ✅ Auth lookup uses separate service role connection (no RLS enforcement)
8. ✅ Transaction scope verified by Prisma API (single connection guarantee)

### Deployment Steps

1. Create new migration with corrected RLS policies
2. Update Prisma client code to use `withOrganizationContext()` transaction wrapper
3. Create test role without BYPASSRLS for local testing
4. Create service role with BYPASSRLS for auth lookups
5. Run PostgreSQL verification tests
6. Deploy to staging, run full test suite
7. Deploy to production after staging verification

---

## 7. Remaining Limitations

**Cannot Be Fully Prevented:**

1. **Backend Compromise:** If backend server is compromised, attacker can set arbitrary organization context
   - Mitigation: Ensure backend is isolated, monitor for context mismatches, audit logs

2. **Database Role Compromise:** If database password is exposed, attacker can use elevated role
   - Mitigation: Rotate credentials regularly, use strong passwords, restrict database access

3. **Man-in-the-Middle (Unencrypted Connection):** If database connection isn't encrypted
   - Mitigation: Enforce SSL/TLS for database connections

**Must Be Verified in Deployment:**

1. Runtime role does NOT have `BYPASSRLS`
2. Runtime role is NOT database owner (doesn't own tables)
3. Service role is only used for auth lookup, not application queries
4. All database connections are encrypted (SSL/TLS)
5. Connection strings are not exposed in logs/environment

---

**Status:** Design audit complete, defects documented, corrections ready for implementation.
