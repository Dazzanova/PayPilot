import React from 'react';
import { useLocation } from 'react-router-dom';
import {
  Menu,
  Search,
  Bell,
  Building,
  CheckCircle2,
} from 'lucide-react';
import { mockCurrentUser } from '../../data/mockData';
import { Badge } from '../ui/Badge';

interface TopNavProps {
  onOpenMobileMenu: () => void;
}

const pageTitles: Record<string, { title: string; subtitle: string }> = {
  '/': { title: 'Dashboard', subtitle: 'Workforce metrics and operational status' },
  '/employees': { title: 'Employees Directory', subtitle: 'Manage organization roster and profiles' },
  '/attendance': { title: 'Attendance Log', subtitle: 'Daily check-in logs and time records' },
  '/leave': { title: 'Leave Management', subtitle: 'Employee time-off requests and approvals' },
  '/payroll': { title: 'Payroll Processing', subtitle: 'Salary cycles, payslips, and disbursements' },
  '/departments': { title: 'Departments', subtitle: 'Organizational units and department leaders' },
  '/settings': { title: 'Organization Settings', subtitle: 'Company profiles, policies, and role permissions' },
};

export const TopNav: React.FC<TopNavProps> = ({ onOpenMobileMenu }) => {
  const location = useLocation();
  const currentInfo = pageTitles[location.pathname] || {
    title: 'PayPilot',
    subtitle: 'Enterprise HRMS & Payroll',
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
            <span className="font-semibold text-slate-800">{mockCurrentUser.organization.name}</span>
            <span className="text-[10px] text-slate-400 block leading-none mt-0.5">
              Tenant ID: {mockCurrentUser.organization.id}
            </span>
          </div>
          <Badge variant="brand" size="sm" className="ml-1">
            Demo
          </Badge>
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

        {/* User profile dropdown affordance */}
        <div className="flex items-center gap-2.5 pl-2 sm:pl-3 border-l border-slate-200">
          <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 font-bold flex items-center justify-center text-xs overflow-hidden border border-brand-200">
            {mockCurrentUser.avatarUrl ? (
              <img
                src={mockCurrentUser.avatarUrl}
                alt={mockCurrentUser.name}
                className="w-full h-full object-cover"
              />
            ) : (
              mockCurrentUser.name.slice(0, 2).toUpperCase()
            )}
          </div>
          <div className="hidden xl:block text-left text-xs leading-snug">
            <div className="font-semibold text-slate-900 flex items-center gap-1">
              {mockCurrentUser.name}
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
            </div>
            <div className="text-slate-400 text-[11px]">
              {mockCurrentUser.role.replace(/_/g, ' ')}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
