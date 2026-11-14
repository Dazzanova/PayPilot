import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/Card';
import { Button } from '../ui/Button';
import { ConfigFeedback } from './ConfigFeedback';
import {
  collectFieldErrors,
  errorMessage,
  inputClass,
  inputErrorClass,
  isNotFound,
  rateError,
} from './configTabHelpers';
import { getTaxSlabs, saveTaxSlabs } from '../../lib/payroll';
import type { PayrollTaxSlabsDto } from '../../types';

interface TaxRow {
  lower: string;
  upper: string;
  rate: string;
}

function toRows(dto: PayrollTaxSlabsDto): TaxRow[] {
  return dto.slabs.map((slab) => ({
    lower: slab.lower,
    upper: slab.upper ?? '',
    rate: String(slab.rate),
  }));
}

function toPayload(rows: TaxRow[]) {
  return rows.map((row) => ({
    lower: row.lower.trim(),
    upper: row.upper.trim() === '' ? null : row.upper.trim(),
    rate: Number(row.rate),
  }));
}

function validate(rows: TaxRow[]): Record<string, string> {
  const errors: Record<string, string> = {};
  if (rows.length === 0) {
    errors.slabs = 'At least one slab is required';
    return errors;
  }

  const bounds = rows.map((row, index) => {
    const lower = row.lower.trim();
    const upper = row.upper.trim();
    const lowerValue = Number(lower);
    const upperValue = upper === '' ? null : Number(upper);

    if (lower === '' || !Number.isFinite(lowerValue) || lowerValue < 0) {
      errors[`slabs.${index}.lower`] = 'Enter a valid lower bound';
    }
    if (upper !== '' && (!Number.isFinite(upperValue) || (upperValue as number) <= lowerValue)) {
      errors[`slabs.${index}.upper`] =
        'Upper bound must be greater than the lower bound';
    }
    const rate = rateError(row.rate);
    if (rate) errors[`slabs.${index}.rate`] = rate;

    return { lower: lowerValue, upper: upperValue };
  });

  if (bounds[0] && bounds[0].lower !== 0) {
    errors['slabs.0.lower'] = 'The first slab must start at zero';
  }

  bounds.forEach((slab, index) => {
    if (index > 0) {
      const previous = bounds[index - 1];
      if (previous.upper === null || previous.upper !== slab.lower) {
        errors[`slabs.${index}.lower`] =
          'Slabs must be contiguous with no gaps or overlaps';
      }
    }
    if (slab.upper === null && index !== bounds.length - 1) {
      errors[`slabs.${index}.upper`] = 'Only the last slab may be unbounded';
    }
  });

  return errors;
}

export const IncomeTaxTab: React.FC = () => {
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [loadedFrom, setLoadedFrom] = useState<string | null>(null);
  const [rows, setRows] = useState<TaxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const load = useCallback(async (date?: string, keepOn404 = false) => {
    setLoading(true);
    setError(null);
    setNotice(null);
    setFieldErrors({});
    try {
      const { taxSlabs } = await getTaxSlabs(date);
      setEffectiveFrom(taxSlabs.effectiveFrom);
      setLoadedFrom(taxSlabs.effectiveFrom);
      setRows(toRows(taxSlabs));
    } catch (caught) {
      if (keepOn404 && isNotFound(caught) && date) {
        setNotice(
          `No income-tax table is effective on ${date}. Saving will create a new version from the rows shown.`
        );
      } else {
        setError(errorMessage(caught, 'Could not load income-tax slabs.'));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changeDate = (value: string) => {
    setEffectiveFrom(value);
    if (value) void load(value, true);
  };

  const updateRow = (index: number, field: keyof TaxRow, value: string) => {
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row
      )
    );
  };

  const addRow = () => {
    setRows((current) => {
      const last = current[current.length - 1];
      return [
        ...current,
        {
          lower: last?.upper.trim() ? last.upper.trim() : '',
          upper: '',
          rate: '0',
        },
      ];
    });
  };

  const removeRow = (index: number) => {
    setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
  };

  const save = async () => {
    setError(null);
    setNotice(null);

    if (!effectiveFrom) {
      setError('Choose an effective date before saving.');
      return;
    }

    const errors = validate(rows);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setError('Fix the highlighted slab values before saving.');
      return;
    }

    setFieldErrors({});
    setSaving(true);
    try {
      const { taxSlabs } = await saveTaxSlabs({
        effectiveFrom,
        slabs: toPayload(rows),
      });
      setEffectiveFrom(taxSlabs.effectiveFrom);
      setLoadedFrom(taxSlabs.effectiveFrom);
      setRows(toRows(taxSlabs));
      setNotice('Income-tax slabs saved.');
    } catch (caught) {
      setFieldErrors(collectFieldErrors(caught));
      setError(errorMessage(caught, 'Could not save income-tax slabs.'));
    } finally {
      setSaving(false);
    }
  };

  const renderError = (path: string) =>
    fieldErrors[path] ? (
      <p className="mt-1 text-[11px] text-rose-600">{fieldErrors[path]}</p>
    ) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Effective from
            </label>
            <input
              type="date"
              value={effectiveFrom}
              onChange={(event) => changeDate(event.target.value)}
              className={`${inputClass} w-44`}
            />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-slate-400">Editing</p>
            <p className="text-xs text-slate-600">
              {loadedFrom ? `Version effective ${loadedFrom}` : 'New version'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            icon={<RefreshCw className="w-4 h-4" />}
            onClick={() => void load(effectiveFrom || undefined)}
            disabled={loading || saving}
          >
            Refresh
          </Button>
          <Button
            icon={<Save className="w-4 h-4" />}
            onClick={() => void save()}
            disabled={loading || saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      <ConfigFeedback error={error} notice={notice} />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Income-tax slabs</CardTitle>
            <CardDescription>
              Annual taxable-income bands used to project monthly TDS under the new regime.
              Slabs must be contiguous, start at zero, and only the last may be unbounded.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-xs">Loading income-tax slabs…</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-600">
                <thead className="bg-slate-50/75 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3.5">From (INR)</th>
                    <th className="px-4 py-3.5">To (INR)</th>
                    <th className="px-4 py-3.5">Rate (%)</th>
                    <th className="px-4 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row, index) => (
                    <tr key={index}>
                      <td className="px-4 py-3 align-top">
                        <input
                          inputMode="decimal"
                          value={row.lower}
                          onChange={(event) => updateRow(index, 'lower', event.target.value)}
                          className={
                            fieldErrors[`slabs.${index}.lower`] ? inputErrorClass : inputClass
                          }
                        />
                        {renderError(`slabs.${index}.lower`)}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <input
                          inputMode="decimal"
                          placeholder="No limit"
                          value={row.upper}
                          onChange={(event) => updateRow(index, 'upper', event.target.value)}
                          className={
                            fieldErrors[`slabs.${index}.upper`] ? inputErrorClass : inputClass
                          }
                        />
                        {renderError(`slabs.${index}.upper`)}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={row.rate}
                          onChange={(event) => updateRow(index, 'rate', event.target.value)}
                          className={
                            fieldErrors[`slabs.${index}.rate`] ? inputErrorClass : inputClass
                          }
                        />
                        {renderError(`slabs.${index}.rate`)}
                      </td>
                      <td className="px-4 py-3 align-top text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Trash2 className="w-3.5 h-3.5" />}
                          onClick={() => removeRow(index)}
                          disabled={rows.length === 1}
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loading && fieldErrors.slabs && (
            <p className="px-4 pb-3 text-[11px] text-rose-600">{fieldErrors.slabs}</p>
          )}
        </CardContent>
        <div className="px-4 py-3 bg-slate-50/75 border-t border-slate-100">
          <Button
            size="sm"
            variant="outline"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={addRow}
            disabled={loading}
          >
            Add slab
          </Button>
        </div>
      </Card>
    </div>
  );
};
