import { Router, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { AuthenticatedRequest } from '../types/auth';

export const authRouter = Router();

/**
 * GET /api/auth/me
 * Returns the authenticated user's profile, role, and organization information
 * 
 * This endpoint:
 * - Requires valid authentication (JWT token)
 * - Returns only safe, non-sensitive user profile data
 * - Provides the user's organization context and role
 * - Never exposes internal IDs that could be used to forge tenant context
 */
authRouter.get(
  '/me',
  requireAuth,
  (req: AuthenticatedRequest, res: Response) => {
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

    res.json({
      success: true,
      data: {
        user: {
          id: req.auth.user.id,
          email: req.auth.user.email,
          role: req.auth.user.role,
          isActive: req.auth.user.isActive,
        },
        organization: {
          id: req.auth.organization.id,
          name: req.auth.organization.name,
          slug: req.auth.organization.slug,
          currency: req.auth.organization.currency,
          timezone: req.auth.organization.timezone,
        },
      },
    });
  }
);
