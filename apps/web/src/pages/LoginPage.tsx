import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Building2, LogIn, AlertCircle, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/Button';

interface LoginLocationState {
  from?: {
    pathname?: string;
    search?: string;
    hash?: string;
  };
}

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    authenticated,
    user,
    signIn,
    signOut,
    loading,
    error: authError,
  } = useAuth();
  const [localError, setLocalError] = useState<string | null>(null);

  const destination =
    (location.state as LoginLocationState | null)?.from?.pathname || '/';

  useEffect(() => {
    if (authenticated && user) {
      navigate(destination, { replace: true });
    }
  }, [authenticated, user, destination, navigate]);

  const handleSignIn = async () => {
    setLocalError(null);

    try {
      await signIn();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to sign in');
    }
  };

  const handleSignOut = async () => {
    setLocalError(null);

    try {
      await signOut();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to sign out');
    }
  };

  const displayError = localError || authError;
  const needsProvisioning = authenticated && !user && !loading;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-200 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-600 rounded-2xl mb-4 shadow-lg shadow-brand-600/20">
            <Building2 className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">PayPilot</h1>
          <p className="text-slate-600 text-sm">
            Enterprise HRMS &amp; Payroll Platform
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl shadow-slate-900/5 p-8 border border-slate-200/50">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-slate-900 mb-1">
              Sign in to your account
            </h2>
            <p className="text-sm text-slate-500">
              Continue to the secure PayPilot sign-in page.
            </p>
          </div>

          {displayError && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-900 mb-0.5">
                  Authentication failed
                </p>
                <p className="text-sm text-red-700">{displayError}</p>
              </div>
            </div>
          )}

          {needsProvisioning ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                You are signed in with Keycloak, but this identity has not been
                linked to a PayPilot user. An administrator must provision the
                account before access is granted.
              </p>
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="w-full"
                icon={<LogOut className="w-5 h-5" />}
                onClick={handleSignOut}
                disabled={loading}
              >
                Sign out
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="primary"
              size="lg"
              className="w-full"
              icon={<LogIn className="w-5 h-5" />}
              onClick={handleSignIn}
              disabled={loading}
            >
              {loading ? 'Checking session...' : 'Continue with Keycloak'}
            </Button>
          )}

          <div className="mt-6 pt-6 border-t border-slate-200">
            <p className="text-xs text-slate-500 text-center">
              Access is managed by your organization administrator.
            </p>
          </div>
        </div>

        <div className="mt-6 text-center">
          <p className="text-xs text-slate-500">
            PayPilot © 2026 · Secure authentication powered by Keycloak
          </p>
        </div>
      </div>
    </div>
  );
};
