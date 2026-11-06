import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import {
  getLoginRedirectUri,
  getLogoutRedirectUri,
  initKeycloak,
  keycloak,
} from '../lib/keycloak';

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  currency: string;
  timezone: string;
}

interface AuthContextType {
  authenticated: boolean;
  user: AuthUser | null;
  organization: Organization | null;
  loading: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const clearSession = useCallback(() => {
    keycloak.clearToken();
    setAuthenticated(false);
    setUser(null);
    setOrganization(null);
  }, []);

  const loadUserProfile = useCallback(async () => {
    if (!keycloak.token) {
      setUser(null);
      setOrganization(null);
      setError('Your session has expired. Please sign in again.');
      return;
    }

    const response = await fetch(`${API_BASE_URL}/auth/me`, {
      headers: {
        Authorization: `Bearer ${keycloak.token}`,
      },
    });

    if (response.status === 401) {
      setUser(null);
      setOrganization(null);
      setError(
        'Your Keycloak account is not linked to a PayPilot user. Contact an administrator.'
      );
      return;
    }

    if (!response.ok) {
      throw new Error('Failed to load your PayPilot profile');
    }

    const data = await response.json();

    if (!data.success || !data.data) {
      throw new Error('Invalid profile response from the server');
    }

    setUser(data.data.user);
    setOrganization(data.data.organization);
    setError(null);
  }, []);

  useEffect(() => {
    let active = true;

    const initialize = async () => {
      try {
        const isAuthenticated = await initKeycloak();

        if (!active) {
          return;
        }

        setAuthenticated(isAuthenticated);

        if (isAuthenticated) {
          await keycloak.updateToken(30);
          await loadUserProfile();
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to initialize authentication'
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void initialize();

    return () => {
      active = false;
    };
  }, [loadUserProfile]);

  useEffect(() => {
    if (!authenticated) {
      return;
    }

    const refresh = async () => {
      try {
        await keycloak.updateToken(60);
      } catch {
        clearSession();
        setError('Your session has expired. Please sign in again.');
      }
    };

    const interval = window.setInterval(refresh, 60_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [authenticated, clearSession]);

  const signIn = async () => {
    setLoading(true);
    setError(null);

    try {
      await keycloak.login({ redirectUri: getLoginRedirectUri() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign in');
      setLoading(false);
    }
  };

  const signOut = async () => {
    setLoading(true);
    setError(null);

    try {
      await keycloak.logout({ redirectUri: getLogoutRedirectUri() });
    } finally {
      clearSession();
      setLoading(false);
    }
  };

  const getAccessToken = async (): Promise<string | null> => {
    if (!keycloak.authenticated) {
      return null;
    }

    try {
      await keycloak.updateToken(30);
      return keycloak.token ?? null;
    } catch {
      clearSession();
      return null;
    }
  };

  const value: AuthContextType = {
    authenticated,
    user,
    organization,
    loading,
    error,
    signIn,
    signOut,
    getAccessToken,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
