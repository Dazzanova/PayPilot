import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, Plus, RefreshCw, Trash2, Wallet } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../ui/Table';
import { EmptyState } from '../ui/EmptyState';
import { Modal } from '../ui/Modal';
import { ApiError } from '../../lib/api';
import {
  createDeductionRule,
  deleteDeductionRule,
  listDeductionRules,
  updateDeductionRule,
} from '../../lib/payroll';
import { useAuth } from '../../contexts/AuthContext';
import { formatMoney } from '../../lib/utils';
import type { DeductionRuleDto } from '../../types';

interface RuleForm {
  name: string;
  type: 'RATE' | 'FIXED';
  value: string;
  taxable: boolean;
  active: boolean;
}

const EMPTY_FORM: RuleForm = {
  name: '',
  type: 'RATE',
  value: '10',
  taxable: true,
  active: true,
};

export const DeductionRulesTab: React.FC = () => {
  const { organization } = useAuth();
  const currency = organization?.currency ?? 'USD';

  const [rules, setRules] = useState<DeductionRuleDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DeductionRuleDto | null>(null);
  const [form, setForm] = useState<RuleForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<DeductionRuleDto | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listDeductionRules();
      setRules(result.rules);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load deduction rules.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (rule: DeductionRuleDto) => {
    setEditing(rule);
    setForm({
      name: rule.name,
      type: rule.type,
      value: rule.value,
      taxable: rule.taxable,
      active: rule.active,
    });
    setFormOpen(true);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: form.name,
        type: form.type,
        value: Number(form.value),
        taxable: form.taxable,
        active: form.active,
      };
      if (editing) await updateDeductionRule(editing.id, payload);
      else await createDeductionRule(payload);
      setFormOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save the rule.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setSaving(true);
    setError(null);
    try {
      await deleteDeductionRule(deleting.id);
      setDeleting(null);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not delete the rule.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-xs text-slate-500">
          Percentage and fixed deductions applied to every payroll calculation.
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            icon={<RefreshCw className="w-4 h-4" />}
            onClick={() => void load()}
            disabled={loading}
          >
            Refresh
          </Button>
          <Button icon={<Plus className="w-4 h-4" />} onClick={openCreate}>
            New Rule
          </Button>
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 rounded-lg text-xs border bg-rose-50 border-rose-200 text-rose-700">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Active configuration</CardTitle>
            <CardDescription>
              Changes apply to future calculations only. Approved runs keep their amounts.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-xs">Loading deduction rules…</span>
            </div>
          ) : rules.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<Wallet className="w-6 h-6" />}
                title="No deduction rules"
                description="Add a rate or fixed deduction to apply it to future payroll runs."
                actionLabel="New Rule"
                onAction={openCreate}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead>Taxable</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell className="font-medium text-slate-900">{rule.name}</TableCell>
                      <TableCell>
                        <Badge variant="info" size="sm">
                          {rule.type === 'RATE' ? 'Percentage' : 'Fixed'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {rule.type === 'RATE'
                          ? `${Number(rule.value).toFixed(2)}%`
                          : formatMoney(Number(rule.value), currency)}
                      </TableCell>
                      <TableCell>{rule.taxable ? 'Yes' : 'No'}</TableCell>
                      <TableCell>
                        <Badge variant={rule.active ? 'success' : 'neutral'} dot size="sm">
                          {rule.active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<Pencil className="w-3.5 h-3.5" />}
                            onClick={() => openEdit(rule)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<Trash2 className="w-3.5 h-3.5" />}
                            onClick={() => setDeleting(rule)}
                          >
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Modal
        open={formOpen}
        title={editing ? 'Edit deduction rule' : 'New deduction rule'}
        description="A percentage is applied to gross pay; a fixed amount is deducted as-is."
        onClose={() => setFormOpen(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="rule-form" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create rule'}
            </Button>
          </div>
        }
      >
        <form id="rule-form" className="space-y-4" onSubmit={submit}>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Name</label>
            <input
              required
              maxLength={100}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Type</label>
              <select
                value={form.type}
                onChange={(event) =>
                  setForm({ ...form, type: event.target.value as 'RATE' | 'FIXED' })
                }
                className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white"
              >
                <option value="RATE">Percentage</option>
                <option value="FIXED">Fixed amount</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {form.type === 'RATE' ? 'Rate (%)' : `Amount (${currency})`}
              </label>
              <input
                required
                type="number"
                min="0.01"
                max={form.type === 'RATE' ? 100 : undefined}
                step="0.01"
                value={form.value}
                onChange={(event) => setForm({ ...form, value: event.target.value })}
                className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
              />
            </div>
          </div>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={form.taxable}
                onChange={(event) => setForm({ ...form, taxable: event.target.checked })}
              />
              Taxable
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(event) => setForm({ ...form, active: event.target.checked })}
              />
              Active
            </label>
          </div>
        </form>
      </Modal>

      <Modal
        open={deleting !== null}
        title="Delete deduction rule"
        description="This removes the rule from future calculations. Historical payslips keep their line items."
        onClose={() => setDeleting(null)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()} disabled={saving}>
              {saving ? 'Deleting…' : 'Delete rule'}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-700">
          Delete <span className="font-semibold">{deleting?.name}</span>?
        </p>
      </Modal>
    </div>
  );
};
