# Authentication Guide

PayPilot delegates authentication to a self-hosted **Keycloak** realm and authorizes requests against internal PayPilot users. The browser authenticates through the public `paypilot-web` client with **Authorization Code + PKCE S256**. The API independently verifies every access token with the realm JWKS and resolves the verified identity to a trusted database record.

## 1. Security Model

- **Public browser client:** `paypilot-web` is a public OIDC client. No client secret exists in the browser.
- **Flow:** Authorization Code with PKCE using `S256`.
- **Disabled flows:** Implicit and hybrid flows are disabled. Direct access grants are disabled for the web client.
- **Redirect restrictions:** The realm allows only `http://localhost:5173/*` in development, with matching web origins and post-logout redirect URIs.
- **Token storage:** Access and refresh tokens are held in memory by `keycloak-js`. PayPilot does not write them to `localStorage` or `sessionStorage`.
- **Backend verification:** `jose` validates signature, algorithm (`RS256`), issuer, audience (`paypilot-api`), expiration, and not-before against the Keycloak JWKS.
- **Provider-neutral identity:** PayPilot stores the exact `(identityIssuer, identitySubject)` pair. Email is profile data, not an identity key.
- **No email auto-linking:** An account is usable only after an administrator provisions and links the exact Keycloak subject.
- **Server-side authorization:** Role and organization always come from the database, never from request parameters or token claims.

## 2. Local Keycloak Configuration

The Docker Compose stack imports `docker/keycloak/realm/paypilot-realm.json` into a realm named `paypilot`.

```ini
KEYCLOAK_URL=http://localhost:8080
KEYCLOAK_REALM=paypilot
KEYCLOAK_CLIENT_ID=paypilot-web
KEYCLOAK_ISSUER=http://localhost:8080/realms/paypilot
KEYCLOAK_AUDIENCE=paypilot-api

# Optional. Defaults to <issuer>/protocol/openid-connect/certs
# KEYCLOAK_JWKS_URI=http://localhost:8080/realms/paypilot/protocol/openid-connect/certs

KEYCLOAK_ADMIN_USER=admin
KEYCLOAK_ADMIN_PASSWORD=<strong-local-admin-password>
KEYCLOAK_DEV_USER_PASSWORD=<strong-local-user-password>
```

Keycloak uses its own PostgreSQL database (`keycloak`) and role (`keycloak`). It does not share credentials or tables with the PayPilot application database.

The realm defines two clients:

| Client | Type | Purpose |
|---|---|---|
| `paypilot-web` | Public | Browser login; Authorization Code + PKCE S256 |
| `paypilot-api` | Bearer-only | Resource-server audience expected in access tokens |

An audience mapper adds `paypilot-api` to access tokens. The API rejects tokens that do not carry that audience.

Frontend build-time configuration:

```ini
VITE_API_URL=http://localhost:4000/api
VITE_KEYCLOAK_URL=http://localhost:8080
VITE_KEYCLOAK_REALM=paypilot
VITE_KEYCLOAK_CLIENT_ID=paypilot-web
```

## 3. End-to-End Flow

1. An unauthenticated visitor opens `/login`.
2. Selecting **Continue with Keycloak** calls `keycloak.login()` with the Authorization Code flow and PKCE S256 challenge.
3. Keycloak authenticates the user and redirects to the registered redirect URI with an authorization code.
4. `keycloak-js` exchanges the code plus the PKCE verifier at the token endpoint.
5. `AuthContext` calls `GET /api/auth/me` with `Authorization: Bearer <access_token>`.
6. `requireAuth` extracts the bearer token and calls `verifyKeycloakToken`.
7. `jose` verifies the token against the realm JWKS and checks issuer, audience, algorithm, expiry, and not-before.
8. `resolveIdentity` calls `public.paypilot_resolve_identity(issuer, subject)`. This is the only lookup that happens before tenant context exists. It returns only `user_id` and `organization_id`.
9. `loadAuthContext` starts a Prisma interactive transaction, sets `app.current_organization_id` transaction-locally, and loads the user plus organization under RLS.
10. The API updates `lastLoginAt`, returns the profile, and the SPA stores the session only in memory.
11. `AuthContext` refreshes the token before expiry and on tab visibility. If refresh fails, the in-memory session is cleared and the user must sign in again.

Logout redirects to Keycloak's end-session endpoint and back to `/login`.

## 4. Provisioning a User

Authentication alone does not grant access. A Keycloak identity must be linked to a PayPilot user by an administrator.

```bash
npm run provision:user -- \
  --email admin@paypilot.local \
  --org-name "PayPilot Demo" \
  --role ADMIN
```

What the script does:

1. Refuses to run when `NODE_ENV=production`.
2. Obtains a Keycloak admin token from the `master` realm.
3. Finds or creates the Keycloak user with the given email/username.
4. Sets the development password from `KEYCLOAK_DEV_USER_PASSWORD`.
5. Finds or creates the PayPilot organization and user using `DIRECT_URL`.
6. Writes the exact Keycloak issuer and subject to `identity_issuer` and `identity_subject`.
7. Refuses to overwrite an existing link to a different identity.

Supported options:

```text
--email <email>                 Required
--org-name <name>               Required when creating a new PayPilot user
--role <role>                   Default: EMPLOYEE
--identity-subject <subject>    Link an existing Keycloak subject explicitly
--keycloak-username <username>  Defaults to the email
```

Valid roles: `SUPER_ADMIN`, `ADMIN`, `HR_MANAGER`, `MANAGER`, `EMPLOYEE`.

Provisioning is intentionally separate from login. There is no "first login creates an account" path and no matching on email.

## 5. API Error Behavior

| Condition | HTTP | Error code |
|---|---|---|
| Missing or malformed `Authorization` header | `401` | `NO_TOKEN` |
| Invalid signature, issuer, audience, algorithm, or claims | `401` | `INVALID_TOKEN` |
| Expired token | `401` | `TOKEN_EXPIRED` |
| JWKS/identity provider unreachable | `503` | `AUTH_UNAVAILABLE` |
| Verified identity has no PayPilot mapping | `401` | `IDENTITY_NOT_PROVISIONED` |
| Mapped user no longer exists | `401` | `USER_NOT_FOUND` |
| Mapped user is inactive | `403` | `USER_INACTIVE` |
| User has no organization | `403` | `NO_ORGANIZATION` |
| Authenticated user lacks a required role | `403` | `INSUFFICIENT_PERMISSIONS` |

The SPA treats a `401` from `/api/auth/me` as an unprovisioned or expired session and shows a clear message instead of granting access.

## 6. Database Identity Mapping

The `users` table contains:

```prisma
identityIssuer  String? @map("identity_issuer")
identitySubject String? @map("identity_subject")

@@unique([identityIssuer, identitySubject])
```

A check constraint ensures both fields are either set or both null. Legacy Supabase subjects, when upgrading an existing database, are stored under the `supabase` issuer and are **not** trusted for Keycloak login. They must be re-provisioned deliberately.

## 7. Verification

The repository includes:

- Unit tests for JWKS verification, issuer/audience/expiry/algorithm rejection, middleware behavior, and role checks.
- Real-PostgreSQL integration tests for identity resolution, inactive users, unlinked identities, and duplicate mapping enforcement.

```bash
npm test
npm run test:integration
```

The integration suite requires the Docker stack and `DIRECT_URL`.

A manual end-to-end check can be performed by signing in at http://localhost:5173/login, then calling:

```bash
curl -H "Authorization: Bearer <access_token>" http://localhost:4000/api/auth/me
```

## 8. Troubleshooting

### `IDENTITY_NOT_PROVISIONED`

The Keycloak user authenticated successfully but no PayPilot user has that exact issuer/subject. Run the provisioning script for the same email, or pass the exact subject with `--identity-subject`.

### `TOKEN_EXPIRED` immediately after login

Check the host clock and the realm's `accessTokenLifespan`. The verifier allows a five-second clock tolerance.

### `AUTH_UNAVAILABLE`

The API cannot reach the Keycloak realm JWKS endpoint. Confirm Keycloak is healthy and `KEYCLOAK_ISSUER` matches the URL a browser and the API can reach.

A mismatch such as `localhost` versus `127.0.0.1` changes the issuer and is rejected.

### Login redirects to an error page

Confirm `http://localhost:5173/*` remains in the web client's redirect URIs and that the SPA runs on port `5173`.

### Provisioning fails with HTTP 401/403

Check `KEYCLOAK_ADMIN_USER` and `KEYCLOAK_ADMIN_PASSWORD`. These are the bootstrap administrator credentials for the `master` realm, not an application user's credentials.

## 9. Production Checklist

- Terminate TLS in front of Keycloak and the API.
- Set `sslRequired` appropriately and replace the development realm import with a managed realm.
- Use strong, unique secrets and rotate the bootstrap administrator.
- Enable MFA and an appropriate password policy.
- Configure SMTP for verification and password reset.
- Back up the Keycloak database and the PayPilot database independently.
- Restrict redirect URIs and web origins to production hostnames.
- Keep `KEYCLOAK_DEV_USER_PASSWORD` and the provisioning script out of production use.
- Keep access tokens in memory or move to a hardened BFF pattern; never store them in web storage.
