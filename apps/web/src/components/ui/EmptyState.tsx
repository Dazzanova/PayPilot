import React from 'react';
import { Button } from './Button';
import { cn } from '../../lib/utils';

export interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  className,
}) => {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center p-8 text-center bg-white rounded-xl border border-dashed border-slate-300',
        className
      )}
    >
      <div className="p-3 bg-slate-50 text-slate-400 rounded-full mb-3.5">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      <p className="text-xs text-slate-500 mt-1 max-w-sm">{description}</p>
      {actionLabel && (
        <Button
          size="sm"
          variant="outline"
          className="mt-4"
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );
};
