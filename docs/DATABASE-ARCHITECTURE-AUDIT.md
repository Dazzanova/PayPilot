> **Historical snapshot (pre-migration).** This document describes the former Supabase-based architecture and is retained for project history. For current setup, see [architecture.md](./architecture.md), [authentication.md](./authentication.md), and [RLS-IMPLEMENTATION.md](./RLS-IMPLEMENTATION.md).

# Database Architecture Audit - Milestone 3 Planning

**Date:** October 14, 2026  
**Scope:** RLS design and implementation feasibility assessment

---

## Executive Summary

PayPilot's database architecture is ready for RLS implementation. The system uses:
- Supabase PostgreSQL (supports RLS)
- Prisma ORM with connection pooling
- Application-level tenant context (verified JWT → organization)
- No current PostgreSQL context propagation or RLS

**Key Finding:** RLS can be safely implemented by extending the authentication middleware to set a transaction-scoped database role or connection context, allowing policies to enforce tenant boundaries at the database level.

---

## 1. Current Database Architecture

### Connection Configuration

```
DATABASE_URL: Transaction pooler (pgbouncer) on port 6543
DIRECT_URL: Direct session on port 5432

Runtime User: Configured via DATABASE_URL (typically "postgres" or Supabase auth role)
RLS Capability: Available (PostgreSQL 9.5+)
Current RLS State: Not enabled
```

**Key Issues:**
- Runtime connection uses default/admin user (likely "postgres")
- No per-request tenant context propagated to PostgreSQL
- Prisma Client connects with fixed credentials, no session-level variables

### Prisma Configuration

```typescript
// apps/api/src/lib/prisma.ts
const prisma = new PrismaClient({
  log: ['warn', 'error'],  // Only logs warnings/errors
});
```

**Implications:**
- All queries execute under the same database role
- No connection customization per request
- Prisma middleware could intercept queries but doesn't currently
- Connection pooling reuses connections (transaction-scoped cleanup needed)

### Authentication Middleware

```typescript
// apps/api/src/middleware/auth.ts
async function requireAuth(req, res, next) {
  // 1. Verify JWT token (Supabase SDK)
  const supabaseAuthId = await verifySupabaseToken(token);
  
  // 2. Load user + organization from database
  const authContext = await loadAuthContext(supabaseAuthId);
  
  // 3. Attach to Express request
  req.auth = authContext;
  next();
}
```

**Current State:**
- Organization context obtained **after** database query
- Database queries use authenticated user's permissions (impossible currently)
- No mechanism to propagate `organizationId` to PostgreSQL

---

## 2. Tenant-Scoped Tables

Tables requiring RLS enforcement:

| Table | Relationship | Foreign Key | Type |
|---|---|---|---|
| `departments` | → organization | organizationId | Owned |
| `employees` | → organization | organizationId | Owned |
| `attendanceRecords` | → organization | organizationId | Owned |
| `leaveRequests` | → organization | organizationId | Owned |
| `payrollRuns` | → organization | organizationId | Owned |
| `payslips` | → organization | organizationId | Owned |
| `auditLogs` | → organization | organizationId | Owned |

**Shared/Administrative Tables (require careful handling):**
- `users`: Must allow cross-organization queries for auth lookup, but restrict updates
- `organizations`: Restrict access to own organization's metadata
- Auth-specific tables: May need privileged access path

---

## 3. Current Data Flow

### Authentication Query (Before RLS)

```
1. Request arrives with JWT token
2. Middleware calls Supabase SDK getUser() → obtains supabaseAuthId
3. Query: SELECT * FROM users WHERE supabaseAuthId = $1
   - This query CANNOT be RLS-protected yet (happens before org context)
4. Obtain organizationId from result
5. Attach {userId, organizationId, ...} to req.auth
6. Next middleware/handler uses req.auth for authorization
```

**Problem:** User lookup must happen before RLS context can be set.

### Application Query (After RLS)

```
1. Handler accesses req.auth.organization.id (verified)
2. Query: SELECT * FROM employees WHERE organizationId = $1 AND ...
   - This query CAN be RLS-protected if context is set in PostgreSQL
```

---

## 4. RLS Enforcement Mechanisms

### Option A: Prisma Middleware + Session Variables (Recommended)

**Approach:**
1. Use Prisma middleware to intercept queries
2. Before each query, execute: `SET SESSION app.current_organization_id = $1`
3. RLS policies check: `(SELECT auth.uid()) = users.id AND current_organization matches`

**Pros:**
- Works with existing Prisma Client
- Transaction-scoped (resets on connection reuse)
- No connection string changes
- Works with connection pooling (pgbouncer in transaction mode)

**Cons:**
- Requires middleware for every query
- Session variables must be set before each operation
- Small performance overhead

**Implementation Feasibility:** ✅ HIGH - Direct match for Prisma architecture

### Option B: Database Roles Per Request

**Approach:**
1. Create role per organization: `org_<id>_user`
2. Switch role before query: `SET ROLE org_<id>_user`
3. RLS policies check: `current_user_id IN (...)`

**Pros:**
- Cleaner permission model
- Role-based policies native to PostgreSQL

**Cons:**
- Cannot use with pgbouncer transaction pooling (roles don't persist)
- Requires session pooling (Supabase uses transaction)
- Incompatible with current setup

**Implementation Feasibility:** ❌ LOW - Requires architecture change

### Option C: Row-Level View with Application Context

**Approach:**
1. Create views that filter based on application-supplied context
2. Pass organizationId as query parameter
3. Views enforce: `organizationId = $1`

**Pros:**
- Works with current architecture
- No middleware needed

**Cons:**
- Not true RLS (application logic, not database policy)
- Vulnerable if queries bypass view
- Doesn't solve the problem

**Implementation Feasibility:** ❌ INSUFFICIENT - Doesn't meet requirements

---

## 5. Proposed Design: Prisma Middleware + PostgreSQL Session Variables

### Architecture

```typescript
// 1. Middleware sets tenant context
app.use(requireAuth);  // Sets req.auth.organizationId

// 2. Prisma middleware propagates to PostgreSQL
prisma.$use(async (params, next) => {
  if (req.auth?.organizationId) {
    // Before query: set session variable
    await prisma.$executeRaw`SET app.current_organization_id = ${req.auth.organizationId}::uuid`;
  }
  
  // Execute query
  const result = await next(params);
  
  // After query: reset (optional, will reset on connection reuse)
  return result;
});

// 3. RLS policies check session context
-- For tenant-owned tables
CREATE POLICY org_isolation ON employees
USING (organization_id = (SELECT current_setting('app.current_organization_id')::uuid))
WITH CHECK (organization_id = (SELECT current_setting('app.current_organization_id')::uuid));
```

### Guarantee Model

| Operation | Isolation | Mechanism |
|---|---|---|
| SELECT owned records | ✅ | RLS policy enforces organizationId match |
| INSERT to owned table | ✅ | RLS policy: organizationId must match context + app validation |
| UPDATE owned record | ✅ | RLS policy + app validation |
| DELETE owned record | ✅ | RLS policy + app validation |
| Cross-tenant FK insert | ✅ | App validation + FK constraint + RLS |
| Missing context | ✅ | Session variable unset → policy blocks all |
| Connection reuse | ✅ | Transaction-scoped session variables reset |

### Security Layers

1. **Application Layer:** `req.auth` verified by JWT
2. **Database Layer:** RLS policies enforce organizationId
3. **Constraint Layer:** Foreign keys prevent orphaned records
4. **Connection Layer:** Session variables reset per transaction

---

## 6. User Lookup Exception

### Problem

User lookup must happen **before** RLS context exists:

```typescript
// Step 1: Verify JWT (app doesn't know organization yet)
const supabaseAuthId = await verifySupabaseToken(token);

// Step 2: Look up user by supabaseAuthId
//        Cannot use RLS context (doesn't exist yet!)
const user = await prisma.user.findUnique({
  where: { supabaseAuthId }
});
```

### Solution

Create a privileged lookup path:

```sql
-- Create a function accessible to app role
CREATE FUNCTION lookup_user_by_supabase_id(p_supabase_id text)
RETURNS TABLE (
  id uuid,
  supabase_auth_id text,
  email text,
  role user_role,
  is_active boolean,
  organization_id uuid
) AS $$
BEGIN
  -- This function can bypass RLS (owned by postgres, runs with definer rights)
  RETURN QUERY
  SELECT u.id, u.supabase_auth_id, u.email, u.role, u.is_active, u.organization_id
  FROM users u
  WHERE u.supabase_auth_id = p_supabase_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to app role
GRANT EXECUTE ON FUNCTION lookup_user_by_supabase_id TO app_user;
```

### Alternative Simpler Approach

Keep user lookup without RLS policy (allow public read):

```sql
-- Users table: allow read (needed for auth lookup)
CREATE POLICY user_read ON users
FOR SELECT
USING (true);  -- Anyone can look up users by supabase_id

-- But prevent tenant from seeing/modifying other tenants' associations
CREATE POLICY user_prevent_tenant_reassign ON users
FOR UPDATE
USING (organization_id = (SELECT current_setting('app.current_organization_id')::uuid))
WITH CHECK (organization_id = (SELECT current_setting('app.current_organization_id')::uuid));
```

**Rationale:** User list is not sensitive; sensitive operations (modify, create) are protected.

---

## 7. Expected Query Flows

### Authentication (No RLS needed)

```
Request: Bearer eyJhbGc...
↓
Middleware: Verify JWT
↓
Query: SELECT * FROM users WHERE supabase_auth_id = $1
  └─ No RLS (auth lookup happens first)
  └─ Returns user + organization_id
↓
Set req.auth = {userId, organizationId, ...}
↓
Proceed to handler
```

### Protected Query (RLS enforced)

```
Handler: SELECT * FROM employees WHERE id = $1
↓
Prisma Middleware:
  SET app.current_organization_id = req.auth.organizationId
↓
PostgreSQL:
  SELECT * FROM employees WHERE id = $1
  └─ RLS policy checks:
     organization_id = current_setting('app.current_organization_id')::uuid
  └─ Rejects if org_id ≠ session variable
↓
Return result (empty if not authorized)
```

### Cross-Tenant Attempt (RLS blocks)

```
Attacker: Directly query employees for organization B
  SELECT * FROM employees WHERE organization_id = 'org-b-id'

PostgreSQL RLS check:
  organization_id (org-b-id) = current_setting('app.current_organization_id') (org-a-id)
  → FALSE
  → Query blocked, returns empty result
```

---

## 8. Implementation Requirements

### Code Changes Needed

1. **Authentication Middleware Extension** (`apps/api/src/middleware/auth.ts`)
   - After loading auth context, pass organizationId to Prisma
   - Ensure connection scoping

2. **Prisma Client Middleware** (`apps/api/src/lib/prisma.ts`)
   - Add `prisma.$use()` middleware
   - Set session variable before query
   - Reset after transaction

3. **New SQL Migrations** (`prisma/migrations/`)
   - Enable RLS on tenant-owned tables
   - Create policies for SELECT, INSERT, UPDATE, DELETE
   - Update table permissions

4. **Tests** (`apps/api/src/**/*.test.ts`)
   - Verify cross-tenant queries blocked
   - Verify missing context fails
   - Verify connection reuse doesn't leak

### No Changes Needed

- Prisma schema (no type changes)
- Database connection strings (works with existing pooling)
- Authentication flow (JWT verification unchanged)
- Frontend code

---

## 9. Risk Assessment

### Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Session variable not set | LOW | Middleware always sets before query |
| Stale session variable on connection reuse | LOW | Variables are transaction-scoped (pgbouncer) |
| RLS policy syntax errors | MEDIUM | Test in staging before production |
| Legitimate cross-tenant query blocked | LOW | Test to verify legitimate flows still work |
| Performance degradation | LOW | Session variable setting is minimal overhead |
| Bypassing via raw queries | MEDIUM | Use Prisma sanitization + app validation |

### Verification Strategy

1. **Unit Tests:** RLS policies work in isolation
2. **Integration Tests:** Full query flow with Prisma + RLS
3. **Staging Tests:** Against real PostgreSQL with RLS enabled
4. **Penetration Tests:** Attempt cross-tenant access via various methods

---

## 10. Rollback & Safety

### Rollout Plan

1. **Stage 1:** Deploy RLS policies disabled (test coverage only)
2. **Stage 2:** Enable RLS on non-critical table (e.g., auditLogs)
3. **Stage 3:** Verify no app breakage in production
4. **Stage 4:** Enable RLS on employee/payroll tables
5. **Stage 5:** Full enforcement

### Rollback

- RLS policies are DDL operations (can be dropped)
- Session variable setting is application code (can be disabled)
- Zero data loss, fully reversible

---

## Conclusion

✅ **RLS Implementation is Feasible**

**Recommended Approach:**
- Prisma middleware + PostgreSQL session variables
- Simple, compatible with existing architecture
- Strong isolation guarantees
- Testable and verifiable

**Next Steps:**
1. Design specific policies for each table
2. Create migrations
3. Implement Prisma middleware
4. Write integration tests
5. Deploy to staging
6. Verify in production before full rollout

---

**Architecture Assessment:** APPROVED FOR IMPLEMENTATION  
**Risk Level:** LOW (reversible, testable, well-understood pattern)
