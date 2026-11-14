import React from 'react';

export interface ConfigFeedbackProps {
  error: string | null;
  notice: string | null;
}

export const ConfigFeedback: React.FC<ConfigFeedbackProps> = ({ error, notice }) => {
  if (!error && !notice) return null;

  return (
    <div className="space-y-2">
      {error && (
        <div
          role="alert"
          className="px-3 py-2 rounded-lg text-xs border bg-rose-50 border-rose-200 text-rose-700"
        >
          {error}
        </div>
      )}
      {notice && (
        <div className="px-3 py-2 rounded-lg text-xs border bg-sky-50 border-sky-200 text-sky-700">
          {notice}
        </div>
      )}
    </div>
  );
};
