import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ApiError } from '../../lib/api';
import { changeEmployeeStatus } from '../../lib/employees';
import type { EmployeeDto, EmployeeStatus } from '../../types';

const STATUSES: EmployeeStatus[] = [
  'ACTIVE',
  'ON_LEAVE',
  'SUSPENDED',
  'TERMINATED',
];

interface EmployeeStatusDialogProps {
  employee: EmployeeDto | null;
  onClose: () => void;
  onSaved: () => void;
}

export const EmployeeStatusDialog: React.FC<EmployeeStatusDialogProps> = ({
  employee,
  onClose,
  onSaved,
}) => {
  const [status, setStatus] = useState<EmployeeStatus>(employee?.status ?? 'ACTIVE');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!employee) {
    return null;
  }

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);

    try {
      await changeEmployeeStatus(employee.id, status);
      onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not change status');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title="Change employee status"
      description={`${employee.firstName} ${employee.lastName} (${employee.employeeNumber})`}
      onClose={saving ? () => undefined : onClose}
      className="max-w-md"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={saving || status === employee.status}
            icon={saving ? <Loader2 className="w-4 h-4 animate-spin" /> : undefined}
          >
            {saving ? 'Saving…' : 'Update status'}
          </Button>
        </>
      }
    >
      <label
        className="block text-xs font-medium text-slate-600 mb-1.5"
        htmlFor="status"
      >
        New status
      </label>
      <select
        id="status"
        value={status}
        onChange={(event) => setStatus(event.target.value as EmployeeStatus)}
        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-500"
      >
        {STATUSES.map((value) => (
          <option key={value} value={value}>
            {value.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
      <p className="text-[11px] text-slate-500 mt-2">
        Status changes are recorded in the audit log. Employee records are never hard
        deleted.
      </p>
      {error && (
        <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mt-3">
          {error}
        </p>
      )}
    </Modal>
  );
};
