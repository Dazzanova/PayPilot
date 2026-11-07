import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Menu,
  Search,
  Bell,
  Building,
  CheckCircle2,
  LogOut,
  User,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface TopNavProps {
  onOpenMobileMenu: () => void;
}

const pageTitles: Record<string, { title: string; subtitle: string }> = {
  '/': { title: 'Dashboard', subtitle: 'Workforce metrics and operational status' },
  '/employees': { title: 'Employees Directory', subtitle: 'Manage organization roster and profiles' },
  '/attendance': { title: 'Attendance Log', subtitle: 'Daily check-in logs and time records' },
  '/leave': { title: 'Leave Management', subtitle: 'Employee time-off requests and approvals' },
  '/payroll': { title: 'Payroll Processing', subtitle: 'Salary cycles, payslips, and disbursements' },
  '/payroll/imports': { title: 'Payroll Imports', subtitle: 'Upload registers and review validation findings' },
  '/payroll/imports/:id': { title: 'Payroll Import Detail', subtitle: 'Validation findings, records, and exception report' },
  '/departments': { title: 'Departments', subtitle: 'Organizational units and department leaders' },
  '/settings': { title: 'Organization Settings', subtitle: 'Company profiles, policies, and role permissions' },
};

export const TopNav: React.FC<TopNavProps> = ({ onOpenMobileMenu }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, organization, signOut } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);

  const currentInfo =
    pageTitles[location.pathname] ||
    (location.pathname.startsWith('/payroll/imports/')
      ? pageTitles['/payroll/imports/:id']
      : undefined) || {
      title: 'PayPilot',
      subtitle: 'Enterprise HRMS & Payroll',
    };

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate('/login');
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };

  const getUserInitials = () => {
    if (!user?.email) return '??';
    const parts = user.email.split('@')[0].split('.');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return user.email.slice(0, 2).toUpperCase();
  };

  const formatRole = (role: string) => {
    return role.replace(/_/g, ' ');
  };

  return (
    <header className="h-16 bg-white border-b border-slate-200/80 sticky top-0 z-30 px-4 sm:px-6 flex items-center justify-between">
      {/* Left: Mobile trigger & Page Title */}
      <div className="flex items-center gap-3 sm:gap-4">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          className="lg:hidden p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
          aria-label="Open sidebar"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div>
          <h1 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">
            {currentInfo.title}
          </h1>
          <p className="hidden md:block text-xs text-slate-500">
            {currentInfo.subtitle}
          </p>
        </div>
      </div>

      {/* Center: Search affordance */}
      <div className="hidden lg:flex items-center flex-1 max-w-md mx-8">
        <div className="relative w-full">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Search employees, departments, or records..."
            className="w-full pl-9 pr-4 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 focus:bg-white transition-all"
            readOnly
          />
          <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 font-mono bg-slate-200/60 px-1.5 py-0.5 rounded">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Right: Tenant Context & User Profile */}
      <div className="flex items-center gap-3 sm:gap-5">
        {/* Organization / Tenant badge */}
        <div className="hidden sm:flex items-center gap-2 pl-3 pr-2 py-1 bg-slate-50 border border-slate-200 rounded-lg">
          <Building className="w-3.5 h-3.5 text-brand-600" />
          <div className="text-left text-xs">
            <span className="font-semibold text-slate-800">
              {organization?.name || 'Loading...'}
            </span>
            {organization && (
              <span className="text-[10px] text-slate-400 block leading-none mt-0.5">
                {organization.slug}
              </span>
            )}
          </div>
        </div>

        {/* Notifications */}
        <div className="relative">
          <button
            type="button"
            className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors relative"
            aria-label="View notifications"
          >
            <Bell className="w-4.5 h-4.5" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-brand-600 ring-2 ring-white" />
          </button>
        </div>

        {/* User profile dropdown */}
        <div className="relative flex items-center gap-2.5 pl-2 sm:pl-3 border-l border-slate-200">
          <button
            type="button"
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2.5 hover:bg-slate-50 rounded-lg px-2 py-1.5 transition-colors"
            aria-label="User menu"
          >
            <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 font-bold flex items-center justify-center text-xs overflow-hidden border border-brand-200">
              {getUserInitials()}
            </div>
            <div className="hidden xl:block text-left text-xs leading-snug">
              <div className="font-semibold text-slate-900 flex items-center gap-1">
                {user?.email?.split('@')[0] || 'User'}
                {user?.isActive && (
                  <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                )}
              </div>
              <div className="text-slate-400 text-[11px]">
                {user?.role ? formatRole(user.role) : 'Loading...'}
              </div>
            </div>
          </button>

          {/* Dropdown menu */}
          {showUserMenu && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowUserMenu(false)}
              />
              <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-lg shadow-lg border border-slate-200 py-2 z-50">
                {/* User info */}
                <div className="px-4 py-3 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-brand-100 text-brand-700 font-bold flex items-center justify-center text-sm border border-brand-200">
                      {getUserInitials()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">
                        {user?.email || 'User'}
                      </div>
                      <div className="text-xs text-slate-500">
                        {user?.role ? formatRole(user.role) : ''}
                      </div>
                    </div>
                  </div>
                  {organization && (
                    <div className="mt-2 pt-2 border-t border-slate-100">
                      <div className="text-xs text-slate-500">Organization</div>
                      <div className="text-sm font-medium text-slate-900">
                        {organization.name}
                      </div>
                    </div>
                  )}
                </div>

                {/* Menu items */}
                <div className="py-1">
                  <button
                    type="button"
                    className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3"
                    onClick={() => {
                      setShowUserMenu(false);
                      navigate('/settings');
                    }}
                  >
                    <User className="w-4 h-4 text-slate-400" />
                    Profile Settings
                  </button>
                  <button
                    type="button"
                    className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-3"
                    onClick={() => {
                      setShowUserMenu(false);
                      handleSignOut();
                    }}
                  >
                    <LogOut className="w-4 h-4" />
                    Sign Out
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
};
