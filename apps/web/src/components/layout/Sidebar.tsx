import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  CalendarCheck,
  CalendarOff,
  Banknote,
  Building2,
  Settings,
  ShieldAlert,
  X,
} from 'lucide-react';
import { cn } from '../../lib/utils';

interface NavItem {
  label: string;
  path: string;
  icon: React.ElementType;
  badge?: string;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard },
  { label: 'Employees', path: '/employees', icon: Users, badge: '10' },
  { label: 'Attendance', path: '/attendance', icon: CalendarCheck },
  { label: 'Leave Management', path: '/leave', icon: CalendarOff, badge: '3' },
  { label: 'Payroll', path: '/payroll', icon: Banknote },
  { label: 'Departments', path: '/departments', icon: Building2 },
  { label: 'Settings', path: '/settings', icon: Settings },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-xs lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar sidebar shell */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 text-slate-300 flex flex-col transition-transform duration-200 ease-in-out lg:static lg:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Brand Header */}
        <div className="h-16 flex items-center justify-between px-5 border-b border-slate-800">
          <NavLink to="/" className="flex items-center gap-3 group" onClick={onClose}>
            <div className="w-9 h-9 rounded-lg bg-brand-600 flex items-center justify-center text-white font-bold text-lg shadow-inner group-hover:bg-brand-500 transition-colors">
              P
            </div>
            <div>
              <div className="text-white font-semibold text-base leading-none tracking-tight">
                PayPilot
              </div>
              <div className="text-[11px] text-slate-400 mt-1 uppercase tracking-wider font-medium">
                HRMS & Payroll
              </div>
            </div>
          </NavLink>

          <button
            type="button"
            className="lg:hidden text-slate-400 hover:text-white p-1 rounded-md"
            onClick={onClose}
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation items */}
        <div className="flex-1 py-5 px-3 space-y-1 overflow-y-auto">
          <div className="px-3 pb-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            Main Operations
          </div>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={onClose}
                end={item.path === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors group',
                    isActive
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                  )
                }
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-4.5 h-4.5 shrink-0 opacity-80 group-hover:opacity-100" />
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-300 group-hover:bg-slate-700">
                    {item.badge}
                  </span>
                )}
              </NavLink>
            );
          })}
        </div>

        {/* Bottom Sandbox Badge */}
        <div className="p-3 m-3 rounded-lg bg-slate-800/80 border border-slate-700/60 text-xs text-slate-400">
          <div className="flex items-center gap-2 text-amber-400 font-semibold mb-1">
            <ShieldAlert className="w-4 h-4" />
            <span>Sandbox Mode</span>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-400">
            Multi-tenant architecture initialized. Role: HR Manager (Demo).
          </p>
        </div>
      </aside>
    </>
  );
};
