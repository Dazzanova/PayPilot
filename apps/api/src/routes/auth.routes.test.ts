import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Response } from 'express';
import { UserRole } from '@prisma/client';
import { authRouter } from './auth.routes';
import { AuthenticatedRequest, AuthContext } from '../types/auth';

interface MockResponse extends Partial<Response> {
  statusCode: number;
  jsonData: any;
}

function createMockResponse(): MockResponse {
  return {
    statusCode: 200,
    jsonData: null,
    status: function (code: number) {
      this.statusCode = code;
      return this;
    },
    json: function (data: any) {
      this.jsonData = data;
      return this;
    },
  };
}

function getMeHandler() {
  const meRoute = (authRouter as any).stack.find(
    (layer: any) =>
      layer.route && layer.route.path === '/me' && layer.route.methods.get
  );
  assert.ok(meRoute, 'Route /me should exist');
  const handlers = meRoute.route.stack;
  return handlers[handlers.length - 1].handle;
}

function createAuthContext(role: UserRole): AuthContext {
  return {
    user: {
      id: 'user-123',
      identityIssuer: 'http://localhost:8080/realms/paypilot',
      identitySubject: 'keycloak-subject',
      email: 'john.doe@example.com',
      role,
      isActive: true,
      organizationId: 'org-789',
    },
    organization: {
      id: 'org-789',
      name: 'Acme Corporation',
      slug: 'acme-corp',
      currency: 'USD',
      timezone: 'America/New_York',
    },
  };
}

describe('Auth Routes', () => {
  describe('GET /api/auth/me', () => {
    it('returns 401 when not authenticated', () => {
      const req = {} as AuthenticatedRequest;
      const res = createMockResponse();

      getMeHandler()(req, res as Response);

      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.jsonData.success, false);
      assert.strictEqual(res.jsonData.error.code, 'NOT_AUTHENTICATED');
    });

    it('returns the user profile and organization when authenticated', () => {
      const req = { auth: createAuthContext(UserRole.ADMIN) } as AuthenticatedRequest;
      const res = createMockResponse();

      getMeHandler()(req, res as Response);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.jsonData.success, true);
      assert.strictEqual(res.jsonData.data.user.id, 'user-123');
      assert.strictEqual(res.jsonData.data.user.email, 'john.doe@example.com');
      assert.strictEqual(res.jsonData.data.user.role, UserRole.ADMIN);
      assert.strictEqual(res.jsonData.data.user.isActive, true);
      assert.strictEqual(res.jsonData.data.organization.id, 'org-789');
      assert.strictEqual(res.jsonData.data.organization.name, 'Acme Corporation');
      assert.strictEqual(res.jsonData.data.organization.slug, 'acme-corp');
      assert.strictEqual(res.jsonData.data.organization.currency, 'USD');
      assert.strictEqual(
        res.jsonData.data.organization.timezone,
        'America/New_York'
      );
    });

    it('does not expose identity mapping or organization foreign keys', () => {
      const req = {
        auth: createAuthContext(UserRole.EMPLOYEE),
      } as AuthenticatedRequest;
      const res = createMockResponse();

      getMeHandler()(req, res as Response);

      const userKeys = Object.keys(res.jsonData.data.user).sort();
      assert.deepStrictEqual(userKeys, ['email', 'id', 'isActive', 'role']);
      assert.strictEqual(res.jsonData.data.user.identityIssuer, undefined);
      assert.strictEqual(res.jsonData.data.user.identitySubject, undefined);
      assert.strictEqual(res.jsonData.data.user.organizationId, undefined);
    });
  });
});
