import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Save } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../ui/Card';
import { Button } from '../ui/Button';
import { ConfigFeedback } from './ConfigFeedback';
import {
  collectFieldErrors,
  errorMessage,
  inputClass,
  inputErrorClass,
  isNotFound,
  moneyError,
  rateError,
} from './configTabHelpers';
import { getStatutorySettings, saveStatutorySettings } from '../../lib/payroll';
import type { PayrollStatutorySettingsDto } from '../../types';

interface SettingsForm {
  standardDeduction: string;
  rebateThreshold: string;
  rebateMax: string;
  cessRate: string;
  pfEmployeeRate: string;
  pfWageCeiling: string;
  esiEmployeeRate: string;
  esiGrossCeiling: string;
}

function toForm(dto: PayrollStatutorySettingsDto): SettingsForm {
  return {
    standardDeduction: dto.standardDeduction,
    rebateThreshold: dto.rebateThreshold,
    rebateMax: dto.rebateMax,
    cessRate: String(dto.cessRate),
    pfEmployeeRate: String(dto.pfEmployeeRate),
    pfWageCeiling: dto.pfWageCeiling,
    esiEmployeeRate: String(dto.esiEmployeeRate),
    esiGrossCeiling: dto.esiGrossCeiling,
  };
}

const MONEY_FIELDS = [
  'standardDeduction',
  'rebateThreshold',
  'rebateMax',
  'pfWageCeiling',
  'esiGrossCeiling',
] as const;

const RATE_FIELDS = ['cessRate', 'pfEmployeeRate', 'esiEmployeeRate'] as const;

function validate(form: SettingsForm): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of MONEY_FIELDS) {
    const message = moneyError(form[field]);
    if (message) errors[field] = message;
  }
  for (const field of RATE_FIELDS) {
    const message = rateError(form[field]);
    if (message) errors[field] = message;
  }
  return errors;
}

interface FieldProps {
  id: keyof SettingsForm;
  label: string;
  hint?: string;
  form: SettingsForm;
  error?: string;
  onChange: (field: keyof SettingsForm, value: string) => void;
}

const Field: React.FC<FieldProps> = ({ id, label, hint, form, error, onChange }) => (
  <div>
    <label htmlFor={`statutory-${id}`} className="block text-xs font-medium text-slate-700 mb-1">
      {label}
    </label>
    <input
      id={`statutory-${id}`}
      inputMode="decimal"
      value={form[id]}
      onChange={(event) => onChange(id, event.target.value)}
      className={error ? inputErrorClass : inputClass}
    />
    {error ? (
      <p className="mt-1 text-[11px] text-rose-600">{error}</p>
    ) : hint ? (
      <p className="mt-1 text-[11px] text-slate-400">{hint}</p>
    ) : null}
  </div>
);

export const StatutorySettingsTab: React.FC = () => {
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [loadedFrom, setLoadedFrom] = useState<string | null>(null);
  const [form, setForm] = useState<SettingsForm>({
    standardDeduction: '',
    rebateThreshold: '',
    rebateMax: '',
    cessRate: '',
    pfEmployeeRate: '',
    pfWageCeiling: '',
    esiEmployeeRate: '',
    esiGrossCeiling: '',
  });
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
      const { statutorySettings } = await getStatutorySettings(date);
      setEffectiveFrom(statutorySettings.effectiveFrom);
      setLoadedFrom(statutorySettings.effectiveFrom);
      setForm(toForm(statutorySettings));
    } catch (caught) {
      if (keepOn404 && isNotFound(caught) && date) {
        setNotice(
          `No statutory setting is effective on ${date}. Saving will create a new version from the values shown.`
        );
      } else {
        setError(errorMessage(caught, 'Could not load statutory settings.'));
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

  const update = (field: keyof SettingsForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const save = async () => {
    setError(null);
    setNotice(null);

    if (!effectiveFrom) {
      setError('Choose an effective date before saving.');
      return;
    }

    const errors = validate(form);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setError('Fix the highlighted values before saving.');
      return;
    }

    setFieldErrors({});
    setSaving(true);
    try {
      const { statutorySettings } = await saveStatutorySettings({
        effectiveFrom,
        standardDeduction: form.standardDeduction.trim(),
        rebateThreshold: form.rebateThreshold.trim(),
        rebateMax: form.rebateMax.trim(),
        cessRate: Number(form.cessRate),
        pfEmployeeRate: Number(form.pfEmployeeRate),
        pfWageCeiling: form.pfWageCeiling.trim(),
        esiEmployeeRate: Number(form.esiEmployeeRate),
        esiGrossCeiling: form.esiGrossCeiling.trim(),
      });
      setEffectiveFrom(statutorySettings.effectiveFrom);
      setLoadedFrom(statutorySettings.effectiveFrom);
      setForm(toForm(statutorySettings));
      setNotice('Statutory settings saved.');
    } catch (caught) {
      setFieldErrors(collectFieldErrors(caught));
      setError(errorMessage(caught, 'Could not save statutory settings.'));
    } finally {
      setSaving(false);
    }
  };

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
            <CardTitle>Statutory rates and thresholds</CardTitle>
            <CardDescription>
              Applied to every INR payroll run whose pay date falls on or after the effective
              date.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-xs">Loading statutory settings…</span>
            </div>
          ) : (
            <div className="space-y-6">
              <section>
                <h4 className="text-xs font-semibold text-slate-800 uppercase tracking-wider mb-3">
                  Income tax
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <Field
                    id="standardDeduction"
                    label="Standard deduction (INR)"
                    form={form}
                    error={fieldErrors.standardDeduction}
                    onChange={update}
                  />
                  <Field
                    id="rebateThreshold"
                    label="§87A rebate threshold (INR)"
                    form={form}
                    error={fieldErrors.rebateThreshold}
                    onChange={update}
                  />
                  <Field
                    id="rebateMax"
                    label="Maximum §87A rebate (INR)"
                    form={form}
                    error={fieldErrors.rebateMax}
                    onChange={update}
                  />
                  <Field
                    id="cessRate"
                    label="Health & education cess (%)"
                    form={form}
                    error={fieldErrors.cessRate}
                    onChange={update}
                  />
                </div>
              </section>

              <section>
                <h4 className="text-xs font-semibold text-slate-800 uppercase tracking-wider mb-3">
                  Provident fund
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <Field
                    id="pfEmployeeRate"
                    label="Employee PF rate (%)"
                    form={form}
                    error={fieldErrors.pfEmployeeRate}
                    onChange={update}
                  />
                  <Field
                    id="pfWageCeiling"
                    label="PF wage ceiling (INR)"
                    hint="Basic pay above this is not counted for PF."
                    form={form}
                    error={fieldErrors.pfWageCeiling}
                    onChange={update}
                  />
                </div>
              </section>

              <section>
                <h4 className="text-xs font-semibold text-slate-800 uppercase tracking-wider mb-3">
                  Employee state insurance
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <Field
                    id="esiEmployeeRate"
                    label="Employee ESI rate (%)"
                    form={form}
                    error={fieldErrors.esiEmployeeRate}
                    onChange={update}
                  />
                  <Field
                    id="esiGrossCeiling"
                    label="ESI gross ceiling (INR)"
                    hint="ESI applies only when prorated gross is at or below this."
                    form={form}
                    error={fieldErrors.esiGrossCeiling}
                    onChange={update}
                  />
                </div>
              </section>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
