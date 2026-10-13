import React from 'react';
import { Card } from './Card';
import { cn } from '../../lib/utils';

export interface StatCardProps {
  title: string;
  value: string | number;
  subtext?: string;
  trend?: {
    value: string;
    positive?: boolean;
    neutral?: boolean;
  };
  icon: React.ReactNode;
  iconBgColor?: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  subtext,
  trend,
  icon,
  iconBgColor = 'bg-brand-50 text-brand-600',
}) => {
  return (
    <Card className="p-5.5 hover:border-slate-300 transition-colors">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{title}</p>
          <p className="text-2xl font-bold tracking-tight text-slate-900 mt-1.5">{value}</p>
        </div>
        <div className={cn('p-2.5 rounded-lg shrink-0', iconBgColor)}>
          {icon}
        </div>
      </div>

      {(trend || subtext) && (
        <div className="mt-3.5 flex items-center gap-2 text-xs">
          {trend && (
            <span
              className={cn(
                'inline-flex items-center font-semibold px-1.5 py-0.5 rounded',
                trend.neutral
                  ? 'bg-slate-100 text-slate-600'
                  : trend.positive
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-rose-50 text-rose-700'
              )}
            >
              {trend.value}
            </span>
          )}
          {subtext && <span className="text-slate-500 truncate">{subtext}</span>}
        </div>
      )}
    </Card>
  );
};
