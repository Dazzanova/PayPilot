import React, { useRef, useState } from 'react';
import { AlertCircle, FileUp, Loader2, Upload } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { ApiError } from '../../lib/api';
import { uploadPayrollImport } from '../../lib/payrollImports';
import type { PayrollImportBatch } from '../../types';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

const COLUMNS = [
  'employee_number',
  'pay_period_start',
  'pay_period_end',
  'currency',
  'gross_pay',
  'total_deductions',
  'net_pay',
];

const SAMPLE_ROW =
  'PP-1001,2026-10-01,2026-10-31,INR,75000.00,12500.00,62500.00';

interface ImportUploadCardProps {
  onUploaded: (batch: PayrollImportBatch) => void;
}

export const ImportUploadCard: React.FC<ImportUploadCardProps> = ({ onUploaded }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Choose a .csv file exported from your payroll system.');
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
      setError('The file is larger than the 5 MB limit.');
      return;
    }

    setUploading(true);
    try {
      const content = await file.text();
      const result = await uploadPayrollImport(file.name, content);
      onUploaded(result.batch);
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'DUPLICATE_IMPORT') {
        setError(
          caught.details?.[0]?.message
            ? `${caught.message} ${caught.details[0].message}`
            : caught.message
        );
      } else {
        setError(caught instanceof ApiError ? caught.message : 'Could not upload the file.');
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Import a payroll register</h3>
          <p className="text-xs text-slate-500 mt-1">
            Upload one CSV for a single currency and a single pay period. Nothing is
            written to finalized payroll runs or payslips.
          </p>
        </div>
        <div className="p-2 rounded-lg bg-brand-50 text-brand-600 shrink-0">
          <FileUp className="w-5 h-5" />
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/60 p-3 overflow-x-auto">
        <p className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
          Required columns
        </p>
        <code className="mt-1 block whitespace-nowrap text-[11px] text-slate-700">
          {COLUMNS.join(',')}
        </code>
        <p className="mt-3 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
          Example row
        </p>
        <code className="mt-1 block whitespace-nowrap text-[11px] text-slate-700">
          {SAMPLE_ROW}
        </code>
        <p className="mt-3 text-[11px] text-slate-500">
          ISO dates (YYYY-MM-DD), three-letter uppercase currency, up to two decimal
          places, 5 MB and 10,000 data rows maximum.
        </p>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          aria-label="Payroll register CSV"
          disabled={uploading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void handleFile(file);
            }
          }}
          className="block w-full max-w-sm text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-200 disabled:opacity-60"
        />
        <Button
          variant="primary"
          size="sm"
          icon={
            uploading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5" />
            )
          }
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? 'Uploading…' : 'Choose CSV'}
        </Button>
      </div>
    </Card>
  );
};
