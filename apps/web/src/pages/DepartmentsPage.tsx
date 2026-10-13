import React, { useState } from 'react';
import {
  Building2,
  Users,
  Plus,
  DollarSign,
  UserCheck,
} from 'lucide-react';
import { mockDepartments } from '../data/mockData';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { DemoDisclaimer } from '../components/ui/DemoDisclaimer';
import { formatCurrency } from '../lib/utils';

export const DepartmentsPage: React.FC = () => {
  const [showModal, setShowModal] = useState(false);

  return (
    <div className="space-y-6">
      <DemoDisclaimer moduleName="departments" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Departments & Divisions</h2>
          <p className="text-xs text-slate-500 mt-1">
            Structural organizational units, leadership assignments, and departmental headcount.
          </p>
        </div>
        <Button
          variant="primary"
          icon={<Plus className="w-4 h-4" />}
          onClick={() => setShowModal(true)}
        >
          Add Department
        </Button>
      </div>

      {/* Department Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {mockDepartments.map((dept) => (
          <Card key={dept.id} className="hover:border-slate-300 transition-all flex flex-col justify-between">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <Badge variant="brand" size="sm" className="font-mono">
                    {dept.code}
                  </Badge>
                  <h3 className="text-base font-bold text-slate-900 mt-2">{dept.name}</h3>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 text-slate-600">
                  <Building2 className="w-4.5 h-4.5" />
                </div>
              </div>

              <p className="text-xs text-slate-500 mt-2.5 line-clamp-2 leading-relaxed">
                {dept.description}
              </p>

              <div className="mt-5 space-y-2.5 pt-4 border-t border-slate-100 text-xs">
                <div className="flex items-center justify-between text-slate-600">
                  <span className="flex items-center gap-1.5 text-slate-500">
                    <UserCheck className="w-3.5 h-3.5" /> Department Lead:
                  </span>
                  <span className="font-semibold text-slate-800">{dept.headOfDepartment}</span>
                </div>

                <div className="flex items-center justify-between text-slate-600">
                  <span className="flex items-center gap-1.5 text-slate-500">
                    <Users className="w-3.5 h-3.5" /> Active Staff:
                  </span>
                  <span className="font-semibold text-slate-800">{dept.employeeCount} members</span>
                </div>

                <div className="flex items-center justify-between text-slate-600">
                  <span className="flex items-center gap-1.5 text-slate-500">
                    <DollarSign className="w-3.5 h-3.5" /> Budget Pool:
                  </span>
                  <span className="font-semibold text-slate-800">
                    {formatCurrency(dept.allocatedBudget)} / mo
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Demo Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <div className="w-10 h-10 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center mb-4">
              <Building2 className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-slate-900">Add Department (Demo)</h3>
            <p className="text-xs text-slate-600 mt-2 leading-relaxed">
              Department hierarchy and custom cost-center mapping will be connected to the backend API during the organization structure phase.
            </p>
            <div className="mt-5 flex justify-end">
              <Button variant="primary" size="sm" onClick={() => setShowModal(false)}>
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
