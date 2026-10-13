import React from 'react';
import { Info } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface DemoDisclaimerProps {
  moduleName?: string;
  className?: string;
}

export const DemoDisclaimer: React.FC<DemoDisclaimerProps> = ({
  moduleName = 'module',
  className,
}) => {
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg bg-amber-50/80 border border-amber-200/80 text-amber-800 text-xs',
        className
      )}
    >
      <Info className="w-4 h-4 text-amber-600 shrink-0" />
      <div className="flex-1">
        <span className="font-semibold">Demo Sandbox Environment:</span> This {moduleName} preview uses typed mock records for demonstration. Interactive changes will not persist to the database during this foundational phase.
      </div>
    </div>
  );
};
