import { Request } from 'express';
import { UserRole } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  identityIssuer: string;
  identitySubject: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  organizationId: string;
}

export interface OrganizationContext {
  id: string;
  name: string;
  slug: string;
  currency: string;
  timezone: string;
}

export interface AuthContext {
  user: AuthenticatedUser;
  organization: OrganizationContext;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
}
