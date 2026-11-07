import { Response, NextFunction } from 'express';
import {
  createRemoteJWKSet,
  errors,
  jwtVerify,
  type JWTVerifyGetKey,
} from 'jose';
import { Prisma, UserRole } from '@prisma/client';
import { config } from '../config/env';
import { prisma } from '../lib/prisma';
import { withOrganizationContext } from '../lib/tenant';
import { logger } from '../lib/logger';
import {
  AuthenticatedRequest,
  AuthContext,
} from '../types/auth';

export class AuthenticationError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 401
  ) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

interface IdentityMapping {
  user_id: string;
  organization_id: string;
}

let keycloakJwks: JWTVerifyGetKey | undefined;

function getKeycloakJwks(): JWTVerifyGetKey {
  if (!keycloakJwks) {
    const jwksUri =
      config.KEYCLOAK_JWKS_URI ??
      `${config.KEYCLOAK_ISSUER.replace(/\/$/, '')}/protocol/openid-connect/certs`;

    keycloakJwks = createRemoteJWKSet(new URL(jwksUri), {
      cacheMaxAge: 10 * 60 * 1000,
      cooldownDuration: 30 * 1000,
    });
  }

  return keycloakJwks;
}

function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  const match = authHeader.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}

/**
 * Verifies a Keycloak access token against the realm JWKS. Signature,
 * algorithm, issuer, audience, expiration and not-before claims are validated
 * by jose before any claim is trusted.
 */
export async function verifyKeycloakToken(
  token: string,
  jwks: JWTVerifyGetKey = getKeycloakJwks()
): Promise<{ issuer: string; subject: string }> {
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: config.KEYCLOAK_ISSUER,
      audience: config.KEYCLOAK_AUDIENCE,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'iss', 'sub', 'aud'],
      clockTolerance: 5,
    });

    if (!payload.iss || !payload.sub) {
      throw new AuthenticationError(
        'Invalid token: missing identity claims',
        'INVALID_TOKEN'
      );
    }

    return {
      issuer: payload.iss,
      subject: payload.sub,
    };
  } catch (error) {
    if (error instanceof AuthenticationError) {
      throw error;
    }

    if (error instanceof errors.JWTExpired) {
      throw new AuthenticationError('Token has expired', 'TOKEN_EXPIRED');
    }

    if (
      error instanceof errors.JWTClaimValidationFailed ||
      error instanceof errors.JWTInvalid ||
      error instanceof errors.JWSInvalid ||
      error instanceof errors.JOSEAlgNotAllowed ||
      error instanceof errors.JWKSNoMatchingKey ||
      error instanceof errors.JWKSMultipleMatchingKeys ||
      error instanceof errors.JWSSignatureVerificationFailed
    ) {
      throw new AuthenticationError('Invalid token', 'INVALID_TOKEN');
    }

    if (
      error instanceof TypeError ||
      (error instanceof Error &&
        /fetch failed|ENOTFOUND|ECONNREFUSED|timed out/i.test(error.message))
    ) {
      logger.error('Unable to fetch Keycloak signing keys', error);
      throw new AuthenticationError(
        'Authentication service is unavailable',
        'AUTH_UNAVAILABLE',
        503
      );
    }

    logger.error('Token verification failed', error);
    throw new AuthenticationError('Invalid token', 'INVALID_TOKEN');
  }
}

/**
 * Resolves an exact (issuer, subject) pair through a narrowly scoped
 * SECURITY DEFINER function. This is the only lookup that happens before
 * tenant context exists; it returns no profile data.
 */
export async function resolveIdentity(
  issuer: string,
  subject: string
): Promise<IdentityMapping | null> {
  const rows = await prisma.$queryRaw<IdentityMapping[]>`
    SELECT user_id, organization_id
    FROM public.paypilot_resolve_identity(${issuer}, ${subject})
  `;

  return rows[0] ?? null;
}

export async function loadAuthContext(
  issuer: string,
  subject: string
): Promise<AuthContext> {
  const identity = await resolveIdentity(issuer, subject);

  if (!identity) {
    throw new AuthenticationError(
      'No PayPilot account is linked to this identity',
      'IDENTITY_NOT_PROVISIONED'
    );
  }

  return withOrganizationContext(identity.organization_id, async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: identity.user_id },
      include: { organization: true },
    });

    if (!user) {
      throw new AuthenticationError(
        'User account not found',
        'USER_NOT_FOUND'
      );
    }

    if (!user.isActive) {
      throw new AuthenticationError(
        'User account is inactive',
        'USER_INACTIVE',
        403
      );
    }

    if (!user.organization) {
      throw new AuthenticationError(
        'User is not associated with an organization',
        'NO_ORGANIZATION',
        403
      );
    }

    await tx.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return {
      user: {
        id: user.id,
        identityIssuer: issuer,
        identitySubject: subject,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        organizationId: user.organizationId,
      },
      organization: {
        id: user.organization.id,
        name: user.organization.name,
        slug: user.organization.slug,
        currency: user.organization.currency,
        timezone: user.organization.timezone,
      },
    };
  });
}

/**
 * Authentication middleware: verifies the bearer token, resolves the verified
 * identity to an internal user, and loads the organization and role from the
 * database. Client-supplied organization or role values are never used.
 */
export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = extractBearerToken(req.headers.authorization);

    if (!token) {
      throw new AuthenticationError(
        'No authentication token provided',
        'NO_TOKEN'
      );
    }

    const { issuer, subject } = await verifyKeycloakToken(token);
    req.auth = await loadAuthContext(issuer, subject);
    next();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      res.status(error.statusCode).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    } else {
      logger.error('Unexpected authentication error', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred during authentication',
        },
      });
    }
  }
}

/**
 * Optional authentication: attaches auth context when a valid token is present
 * but never rejects an unauthenticated request.
 */
export async function optionalAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = extractBearerToken(req.headers.authorization);

    if (token) {
      const { issuer, subject } = await verifyKeycloakToken(token);
      req.auth = await loadAuthContext(issuer, subject);
    }
  } catch (error) {
    logger.warn('Optional authentication failed', error);
  }

  next();
}

/**
 * Role-based authorization middleware. Must run after requireAuth.
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): void => {
    if (!req.auth) {
      res.status(401).json({
        success: false,
        error: {
          code: 'NOT_AUTHENTICATED',
          message: 'Authentication required',
        },
      });
      return;
    }

    if (!allowedRoles.includes(req.auth.user.role)) {
      res.status(403).json({
        success: false,
        error: {
          code: 'INSUFFICIENT_PERMISSIONS',
          message: 'You do not have permission to access this resource',
        },
      });
      return;
    }

    next();
  };
}

export interface TenantRouteResponse {
  status?: number;
  location?: string;
  body?: unknown;
  /** Send a generated attachment instead of JSON, after the transaction commits. */
  file?: { content: string; contentType: string; filename: string };
}

/**
 * Wraps a protected route handler in a single transaction with tenant context
 * set on that connection. All queries in the handler must use the provided tx.
 *
 * The handler returns the response instead of writing it so nothing is sent to
 * the client until the transaction has committed. If the transaction rolls
 * back, the request fails instead of reporting a success that was never saved.
 */
export function tenantRouteHandler(
  handler: (
    req: AuthenticatedRequest,
    tx: Prisma.TransactionClient
  ) => Promise<TenantRouteResponse>
) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    const organizationId = req.auth?.organization.id;

    if (!organizationId) {
      res.status(401).json({
        success: false,
        error: {
          code: 'NO_TENANT_CONTEXT',
          message: 'Tenant context is required for this operation',
        },
      });
      return;
    }

    try {
      const response = await withOrganizationContext(organizationId, (tx) =>
        handler(req, tx)
      );

      if (response.file) {
        res
          .status(response.status ?? 200)
          .set('Content-Type', response.file.contentType)
          .set('Content-Disposition', `attachment; filename="${response.file.filename}"`)
          .set('Cache-Control', 'no-store')
          .send(response.file.content);
        return;
      }

      if (response.location) {
        res.location(response.location);
      }

      res.status(response.status ?? 200).json(response.body);
    } catch (error) {
      next(error);
    }
  };
}
