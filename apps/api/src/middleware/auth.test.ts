import { describe, it, before, mock } from 'node:test';
import assert from 'node:assert';
import { Request, Response, NextFunction } from 'express';
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWK,
  type KeyLike,
} from 'jose';
import { UserRole } from '@prisma/client';
import {
  AuthenticationError,
  requireAuth,
  requireRole,
  verifyKeycloakToken,
} from './auth';
import { AuthenticatedRequest, AuthContext } from '../types/auth';

const issuer = process.env.KEYCLOAK_ISSUER || 'http://localhost:8080/realms/paypilot';
const audience = process.env.KEYCLOAK_AUDIENCE || 'paypilot-api';

let privateKey: KeyLike;
let jwks: ReturnType<typeof createLocalJWKSet>;
let otherPrivateKey: KeyLike;
let otherJwks: ReturnType<typeof createLocalJWKSet>;

function createMockRequest(authHeader?: string, auth?: AuthContext): AuthenticatedRequest {
  return {
    headers: {
      authorization: authHeader,
    },
    auth,
  } as AuthenticatedRequest;
}

interface MockResponse extends Partial<Response> {
  statusCode: number;
  jsonData: any;
  statusCalls: number[];
  jsonCalls: any[];
}

function createMockResponse(): MockResponse {
  return {
    statusCode: 200,
    jsonData: null,
    statusCalls: [],
    jsonCalls: [],
    status: function (code: number) {
      this.statusCode = code;
      this.statusCalls.push(code);
      return this;
    },
    json: function (data: any) {
      this.jsonData = data;
      this.jsonCalls.push(data);
      return this;
    },
  };
}

async function createSigningMaterial() {
  const { publicKey, privateKey: generatedPrivateKey } = await generateKeyPair('RS256');
  const jwk: JWK = await exportJWK(publicKey);
  jwk.kid = 'test-key';
  jwk.alg = 'RS256';
  jwk.use = 'sig';

  return {
    privateKey: generatedPrivateKey,
    jwks: createLocalJWKSet({ keys: [jwk] }),
  };
}

async function signToken(
  overrides: {
    issuer?: string;
    audience?: string;
    subject?: string;
    expiresAt?: number;
    key?: KeyLike;
    kid?: string;
  } = {}
): Promise<string> {
  return new SignJWT({ email: 'someone@example.com' })
    .setProtectedHeader({ alg: 'RS256', kid: overrides.kid ?? 'test-key' })
    .setIssuer(overrides.issuer ?? issuer)
    .setAudience(overrides.audience ?? audience)
    .setSubject(overrides.subject ?? 'keycloak-subject')
    .setIssuedAt()
    .setExpirationTime(overrides.expiresAt ?? '5m')
    .sign(overrides.key ?? privateKey);
}

before(async () => {
  const primary = await createSigningMaterial();
  privateKey = primary.privateKey;
  jwks = primary.jwks;

  const other = await createSigningMaterial();
  otherPrivateKey = other.privateKey;
  otherJwks = other.jwks;
});

describe('Keycloak access token verification', () => {
  it('accepts a valid token and returns verified issuer and subject', async () => {
    const token = await signToken();
    const identity = await verifyKeycloakToken(token, jwks);

    assert.strictEqual(identity.issuer, issuer);
    assert.strictEqual(identity.subject, 'keycloak-subject');
  });

  it('rejects a token from the wrong issuer', async () => {
    const token = await signToken({ issuer: 'http://localhost:8080/realms/other' });

    await assert.rejects(
      () => verifyKeycloakToken(token, jwks),
      (error: unknown) =>
        error instanceof AuthenticationError &&
        error.code === 'INVALID_TOKEN' &&
        error.statusCode === 401
    );
  });

  it('rejects a token for the wrong audience', async () => {
    const token = await signToken({ audience: 'another-api' });

    await assert.rejects(
      () => verifyKeycloakToken(token, jwks),
      (error: unknown) =>
        error instanceof AuthenticationError && error.code === 'INVALID_TOKEN'
    );
  });

  it('rejects an expired token with TOKEN_EXPIRED', async () => {
    const token = await signToken({
      expiresAt: Math.floor(Date.now() / 1000) - 60,
    });

    await assert.rejects(
      () => verifyKeycloakToken(token, jwks),
      (error: unknown) =>
        error instanceof AuthenticationError && error.code === 'TOKEN_EXPIRED'
    );
  });

  it('rejects a token signed by an untrusted key', async () => {
    const token = await signToken({ key: otherPrivateKey });

    await assert.rejects(
      () => verifyKeycloakToken(token, jwks),
      (error: unknown) =>
        error instanceof AuthenticationError && error.code === 'INVALID_TOKEN'
    );
  });

  it('rejects a token with an unpermitted signing algorithm', async () => {
    const secret = new TextEncoder().encode('not-the-keycloak-signing-key');
    const token = await new SignJWT({ email: 'someone@example.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject('keycloak-subject')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(secret);

    await assert.rejects(
      () => verifyKeycloakToken(token, otherJwks),
      (error: unknown) =>
        error instanceof AuthenticationError && error.code === 'INVALID_TOKEN'
    );
  });
});

describe('Authentication middleware', () => {
  it('rejects requests without an Authorization header', async () => {
    const req = createMockRequest();
    const res = createMockResponse();
    const next = mock.fn();

    await requireAuth(req, res as unknown as Response, next as unknown as NextFunction);

    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.jsonData.success, false);
    assert.strictEqual(res.jsonData.error.code, 'NO_TOKEN');
    assert.strictEqual(next.mock.calls.length, 0);
  });

  it('rejects malformed Authorization headers', async () => {
    const req = createMockRequest('InvalidFormat token123');
    const res = createMockResponse();
    const next = mock.fn();

    await requireAuth(req, res as unknown as Response, next as unknown as NextFunction);

    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.jsonData.error.code, 'NO_TOKEN');
  });

  it('rejects an empty bearer token', async () => {
    const req = createMockRequest('Bearer ');
    const res = createMockResponse();
    const next = mock.fn();

    await requireAuth(req, res as unknown as Response, next as unknown as NextFunction);

    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.jsonData.error.code, 'NO_TOKEN');
  });
});

describe('Role authorization middleware', () => {
  const authContext = (role: UserRole): AuthContext => ({
    user: {
      id: 'user-123',
      identityIssuer: issuer,
      identitySubject: 'keycloak-subject',
      email: 'admin@example.com',
      role,
      isActive: true,
      organizationId: 'org-123',
    },
    organization: {
      id: 'org-123',
      name: 'Test Org',
      slug: 'test-org',
      currency: 'USD',
      timezone: 'UTC',
    },
  });

  it('rejects unauthenticated requests', () => {
    const req = createMockRequest() as AuthenticatedRequest;
    const res = createMockResponse();
    const next = mock.fn();

    const middleware = requireRole(UserRole.ADMIN, UserRole.HR_MANAGER);
    middleware(req, res as unknown as Response, next as unknown as NextFunction);

    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.jsonData.error.code, 'NOT_AUTHENTICATED');
    assert.strictEqual(next.mock.calls.length, 0);
  });

  it('rejects users without a required role', () => {
    const req = createMockRequest(undefined, authContext(UserRole.EMPLOYEE));
    const res = createMockResponse();
    const next = mock.fn();

    const middleware = requireRole(UserRole.ADMIN, UserRole.HR_MANAGER);
    middleware(req, res as unknown as Response, next as unknown as NextFunction);

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.jsonData.error.code, 'INSUFFICIENT_PERMISSIONS');
    assert.strictEqual(next.mock.calls.length, 0);
  });

  it('allows users with a required role', () => {
    const req = createMockRequest(undefined, authContext(UserRole.HR_MANAGER));
    const res = createMockResponse();
    const next = mock.fn();

    const middleware = requireRole(UserRole.ADMIN, UserRole.HR_MANAGER);
    middleware(req, res as unknown as Response, next as unknown as NextFunction);

    assert.strictEqual(next.mock.calls.length, 1);
    assert.strictEqual(res.statusCalls.length, 0);
  });
});

describe('AuthenticationError', () => {
  it('preserves message, code, status and name', () => {
    const error = new AuthenticationError('Test message', 'TEST_CODE', 403);

    assert.strictEqual(error.message, 'Test message');
    assert.strictEqual(error.code, 'TEST_CODE');
    assert.strictEqual(error.statusCode, 403);
    assert.strictEqual(error.name, 'AuthenticationError');
  });

  it('defaults to HTTP 401', () => {
    const error = new AuthenticationError('Test', 'TEST');
    assert.strictEqual(error.statusCode, 401);
  });
});
