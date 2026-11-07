import React, { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ApiError } from '../../lib/api';
import { createEmployee, updateEmployee } from '../../lib/employees';
import type {
  DepartmentDto,
  EmployeeCreateInput,
  EmployeeDto,
  EmploymentType,
} from '../../types';

const EMPLOYMENT_TYPES: EmploymentType[] = [
  'FULL_TIME',
  'PART_TIME',
  'CONTRACTOR',
  'INTERN',
];

interface EmployeeFormModalProps {
  open: boolean;
  employee: EmployeeDto | null;
  departments: DepartmentDto[];
  onClose: () => void;
  onSaved: () => void;
}

type FormState = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle: string;
  departmentId: string;
  employmentType: EmploymentType;
  joinedAt: string;
  baseSalary: string;
};

function toFormState(employee: EmployeeDto | null): FormState {
  if (!employee) {
    return {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      jobTitle: '',
      departmentId: '',
      employmentType: 'FULL_TIME',
      joinedAt: new Date().toISOString().slice(0, 10),
      baseSalary: '',
    };
  }

  return {
    firstName: employee.firstName,
    lastName: employee.lastName,
    email: employee.email,
    phone: employee.phone ?? '',
    jobTitle: employee.jobTitle,
    departmentId: employee.departmentId ?? '',
    employmentType: employee.employmentType,
    joinedAt: employee.joinedAt,
    baseSalary: employee.baseSalary,
  };
}

function validate(form: FormState): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!form.firstName.trim()) errors.firstName = 'First name is required';
  if (!form.lastName.trim()) errors.lastName = 'Last name is required';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    errors.email = 'Enter a valid email';
  }
  if (!form.jobTitle.trim()) errors.jobTitle = 'Job title is required';
  if (!form.joinedAt) errors.joinedAt = 'Joined date is required';
  if (
    !/^\d{1,10}(\.\d{1,2})?$/.test(form.baseSalary.trim()) ||
    Number(form.baseSalary) <= 0
  ) {
    errors.baseSalary = 'Enter a positive salary with up to 2 decimals';
  }

  return errors;
}

const fieldClass =
  'w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500';

const labelClass = 'block text-xs font-medium text-slate-600 mb-1.5';

const errorClass = 'text-xs text-rose-600 mt-1';

export const EmployeeFormModal: React.FC<EmployeeFormModalProps> = ({
  open,
  employee,
  departments,
  onClose,
  onSaved,
}) => {
  const [form, setForm] = useState<FormState>(() => toFormState(employee));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const title = employee ? 'Edit employee' : 'Add employee';

  const departmentOptions = useMemo(
    () =>
      departments.map((department) => (
        <option key={department.id} value={department.id}>
          {department.name} ({department.code})
        </option>
      )),
    [departments]
  );

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const nextErrors = validate(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    const payload: EmployeeCreateInput = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim().toLowerCase(),
      phone: form.phone.trim() === '' ? null : form.phone.trim(),
      jobTitle: form.jobTitle.trim(),
      departmentId: form.departmentId === '' ? null : form.departmentId,
      employmentType: form.employmentType,
      joinedAt: form.joinedAt,
      baseSalary: form.baseSalary.trim(),
    };

    setSaving(true);
    setSubmitError(null);

    try {
      if (employee) {
        await updateEmployee(employee.id, payload);
      } else {
        await createEmployee(payload);
      }
      onSaved();
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.details?.length) {
        setErrors(
          Object.fromEntries(
            error.details.map((detail) => [detail.path, detail.message])
          )
        );
        setSubmitError(error.message);
      } else if (error instanceof ApiError) {
        setSubmitError(error.message);
      } else {
        setSubmitError('Could not save the employee. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={title}
      description={
        employee
          ? `Employee ${employee.employeeNumber}. Status changes use the row action.`
          : 'Employee numbers are assigned automatically.'
      }
      onClose={saving ? () => undefined : onClose}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            form="employee-form"
            disabled={saving}
            icon={saving ? <Loader2 className="w-4 h-4 animate-spin" /> : undefined}
          >
            {saving ? 'Saving…' : employee ? 'Save changes' : 'Create employee'}
          </Button>
        </>
      }
    >
      <form
        id="employee-form"
        onSubmit={handleSubmit}
        className="grid grid-cols-1 sm:grid-cols-2 gap-4"
      >
        <div>
          <label className={labelClass} htmlFor="firstName">
            First name
          </label>
          <input
            id="firstName"
            className={fieldClass}
            value={form.firstName}
            onChange={(event) => update('firstName', event.target.value)}
            autoComplete="given-name"
          />
          {errors.firstName && <p className={errorClass}>{errors.firstName}</p>}
        </div>

        <div>
          <label className={labelClass} htmlFor="lastName">
            Last name
          </label>
          <input
            id="lastName"
            className={fieldClass}
            value={form.lastName}
            onChange={(event) => update('lastName', event.target.value)}
            autoComplete="family-name"
          />
          {errors.lastName && <p className={errorClass}>{errors.lastName}</p>}
        </div>

        <div>
          <label className={labelClass} htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            className={fieldClass}
            value={form.email}
            onChange={(event) => update('email', event.target.value)}
            autoComplete="email"
          />
          {errors.email && <p className={errorClass}>{errors.email}</p>}
        </div>

        <div>
          <label className={labelClass} htmlFor="phone">
            Phone (optional)
          </label>
          <input
            id="phone"
            type="tel"
            className={fieldClass}
            value={form.phone}
            onChange={(event) => update('phone', event.target.value)}
            autoComplete="tel"
          />
          {errors.phone && <p className={errorClass}>{errors.phone}</p>}
        </div>

        <div>
          <label className={labelClass} htmlFor="jobTitle">
            Job title
          </label>
          <input
            id="jobTitle"
            className={fieldClass}
            value={form.jobTitle}
            onChange={(event) => update('jobTitle', event.target.value)}
            autoComplete="organization-title"
          />
          {errors.jobTitle && <p className={errorClass}>{errors.jobTitle}</p>}
        </div>

        <div>
          <label className={labelClass} htmlFor="departmentId">
            Department
          </label>
          <select
            id="departmentId"
            className={fieldClass}
            value={form.departmentId}
            onChange={(event) => update('departmentId', event.target.value)}
          >
            <option value="">Unassigned</option>
            {departmentOptions}
          </select>
          {errors.departmentId && <p className={errorClass}>{errors.departmentId}</p>}
        </div>

        <div>
          <label className={labelClass} htmlFor="employmentType">
            Employment type
          </label>
          <select
            id="employmentType"
            className={fieldClass}
            value={form.employmentType}
            onChange={(event) =>
              update('employmentType', event.target.value as EmploymentType)
            }
          >
            {EMPLOYMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          {errors.employmentType && (
            <p className={errorClass}>{errors.employmentType}</p>
          )}
        </div>

        <div>
          <label className={labelClass} htmlFor="joinedAt">
            Joined date
          </label>
          <input
            id="joinedAt"
            type="date"
            className={fieldClass}
            value={form.joinedAt}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(event) => update('joinedAt', event.target.value)}
          />
          {errors.joinedAt && <p className={errorClass}>{errors.joinedAt}</p>}
        </div>

        <div>
          <label className={labelClass} htmlFor="baseSalary">
            Base salary (yearly)
          </label>
          <input
            id="baseSalary"
            inputMode="decimal"
            className={fieldClass}
            value={form.baseSalary}
            onChange={(event) => update('baseSalary', event.target.value)}
            placeholder="90000.00"
          />
          {errors.baseSalary && <p className={errorClass}>{errors.baseSalary}</p>}
        </div>

        {submitError && (
          <p className="sm:col-span-2 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            {submitError}
          </p>
        )}
      </form>
    </Modal>
  );
};
