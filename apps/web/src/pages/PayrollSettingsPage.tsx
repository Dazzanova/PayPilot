import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { DeductionRulesTab } from '../components/payroll/DeductionRulesTab';
import { IncomeTaxTab } from '../components/payroll/IncomeTaxTab';
import { StatutorySettingsTab } from '../components/payroll/StatutorySettingsTab';
import { ProfessionalTaxTab } from '../components/payroll/ProfessionalTaxTab';
import { useAuth } from '../contexts/AuthContext';

const TABS = [
  { id: 'deductions', label: 'Deductions' },
  { id: 'income-tax', label: 'Income tax' },
  { id: 'statutory', label: 'Statutory' },
  { id: 'professional-tax', label: 'Professional tax' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const DEFAULT_TAB: TabId = 'deductions';

function isTabId(value: string | null): value is TabId {
  return TABS.some((tab) => tab.id === value);
}

export const PayrollSettingsPage: React.FC = () => {
  const { organization } = useAuth();
  const currency = organization?.currency ?? 'USD';
  const [searchParams, setSearchParams] = useSearchParams();

  const requested = searchParams.get('tab');
  const tab: TabId = isTabId(requested) ? requested : DEFAULT_TAB;

  const selectTab = (next: TabId) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Payroll Settings</h2>
        <p className="text-xs text-slate-500 mt-1">
          Custom deductions, income-tax slabs, and statutory rates used by payroll runs.
        </p>
      </div>

      {currency !== 'INR' && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Statutory deductions are inactive</p>
            <p className="mt-0.5">
              Payroll skips PF, ESI, professional tax, and TDS while this organization's
              currency is {currency}. Change the organization currency to INR to enable
              them.
            </p>
          </div>
        </div>
      )}

      <div
        className="flex gap-1 overflow-x-auto border-b border-slate-200"
        role="tablist"
        aria-label="Payroll settings"
      >
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => selectTab(item.id)}
            className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap ${
              tab === item.id
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'deductions' && <DeductionRulesTab />}
      {tab === 'income-tax' && <IncomeTaxTab />}
      {tab === 'statutory' && <StatutorySettingsTab />}
      {tab === 'professional-tax' && <ProfessionalTaxTab />}
    </div>
  );
};
