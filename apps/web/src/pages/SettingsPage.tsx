import React from 'react';
import {
  Shield,
  Database,
  Sliders,
  CheckCircle2,
} from 'lucide-react';
import { mockCurrentUser } from '../data/mockData';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { DemoDisclaimer } from '../components/ui/DemoDisclaimer';

export const SettingsPage: React.FC = () => {
  return (
    <div className="space-y-6">
      <DemoDisclaimer moduleName="organization settings" />

      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-900">Tenant & System Settings</h2>
        <p className="text-xs text-slate-500 mt-1">
          Configure organization profiles, multi-tenant parameters, and role-based access rules.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Tenant Profile */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Organization Profile</CardTitle>
                <CardDescription>Primary entity details for this multi-tenant instance</CardDescription>
              </div>
              <Badge variant="brand" size="sm">
                Tenant: {mockCurrentUser.organization.id}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">
                    Company Name
                  </label>
                  <input
                    type="text"
                    defaultValue={mockCurrentUser.organization.name}
                    readOnly
                    className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">
                    Tenant Slug
                  </label>
                  <input
                    type="text"
                    defaultValue="acme-corp"
                    readOnly
                    className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">
                    Primary Currency
                  </label>
                  <input
                    type="text"
                    defaultValue="USD ($) - United States Dollar"
                    readOnly
                    className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">
                    Operational Timezone
                  </label>
                  <input
                    type="text"
                    defaultValue="America/New_York (UTC-04:00)"
                    readOnly
                    className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end">
                <Button variant="outline" size="sm" disabled>
                  Save Changes (Locked in Demo)
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Role-Based Access Hierarchy */}
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Role Permissions Overview</CardTitle>
                <CardDescription>Configured role tiers in the Prisma relational schema</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-slate-100 text-xs">
                <div className="p-4 flex items-start justify-between">
                  <div>
                    <span className="font-semibold text-slate-900 block">SUPER_ADMIN & ADMIN</span>
                    <span className="text-slate-500 mt-0.5 block">
                      Full administrative control over tenant settings, payroll execution, and organization setup.
                    </span>
                  </div>
                  <Badge variant="brand" size="sm">System Level</Badge>
                </div>

                <div className="p-4 flex items-start justify-between bg-brand-50/20">
                  <div>
                    <span className="font-semibold text-brand-900 flex items-center gap-1.5">
                      HR_MANAGER <CheckCircle2 className="w-3.5 h-3.5 text-brand-600" />
                    </span>
                    <span className="text-slate-500 mt-0.5 block">
                      Current demo role. Manages employee records, reviews leave applications, and reviews payroll drafts.
                    </span>
                  </div>
                  <Badge variant="success" size="sm">Active Role</Badge>
                </div>

                <div className="p-4 flex items-start justify-between">
                  <div>
                    <span className="font-semibold text-slate-900 block">MANAGER</span>
                    <span className="text-slate-500 mt-0.5 block">
                      Department-scoped team oversight, attendance verification, and direct-report leave approvals.
                    </span>
                  </div>
                  <Badge variant="neutral" size="sm">Team Scoped</Badge>
                </div>

                <div className="p-4 flex items-start justify-between">
                  <div>
                    <span className="font-semibold text-slate-900 block">EMPLOYEE</span>
                    <span className="text-slate-500 mt-0.5 block">
                      Self-service access to individual punch logs, leave balance requests, and personal payslips.
                    </span>
                  </div>
                  <Badge variant="neutral" size="sm">Self Service</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Database & Infrastructure Status */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Database & Infrastructure</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-xs">
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div className="flex items-center gap-2 text-slate-700 font-semibold mb-1">
                  <Database className="w-4 h-4 text-brand-600" />
                  <span>Supabase PostgreSQL</span>
                </div>
                <p className="text-slate-500 text-[11px] leading-relaxed">
                  Configured via Prisma ORM with connection pooling (<code className="font-mono text-[10px] bg-slate-200/60 px-1 py-0.5 rounded">DATABASE_URL</code>) and direct session migration support (<code className="font-mono text-[10px] bg-slate-200/60 px-1 py-0.5 rounded">DIRECT_URL</code>).
                </p>
              </div>

              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div className="flex items-center gap-2 text-slate-700 font-semibold mb-1">
                  <Shield className="w-4 h-4 text-emerald-600" />
                  <span>Tenant Isolation Policy</span>
                </div>
                <p className="text-slate-500 text-[11px] leading-relaxed">
                  Foreign key scoping enforced on all 9 relational entities. Cross-tenant queries are prevented at schema level.
                </p>
              </div>

              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div className="flex items-center gap-2 text-slate-700 font-semibold mb-1">
                  <Sliders className="w-4 h-4 text-indigo-600" />
                  <span>Monetary Precision</span>
                </div>
                <p className="text-slate-500 text-[11px] leading-relaxed">
                  Using <code className="font-mono text-[10px] bg-slate-200/60 px-1 py-0.5 rounded">Decimal(12,2)</code> and <code className="font-mono text-[10px] bg-slate-200/60 px-1 py-0.5 rounded">Decimal(14,2)</code> to ensure IEEE 754 precision safety for payroll.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};
