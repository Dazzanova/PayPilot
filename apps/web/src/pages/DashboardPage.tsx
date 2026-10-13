import React from 'react';
import {
  Users,
  Clock,
  CalendarOff,
  Banknote,
  ArrowRight,
  Cake,
  Award,
  UserPlus,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { StatCard } from '../components/ui/StatCard';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { DemoDisclaimer } from '../components/ui/DemoDisclaimer';
import {
  mockWeeklyAttendanceData,
  mockDepartmentDistribution,
  mockRecentActivities,
  mockUpcomingEvents,
  mockPayrollRuns,
} from '../data/mockData';
import { formatCurrency } from '../lib/utils';

export const DashboardPage: React.FC = () => {
  const currentPayroll = mockPayrollRuns[1]; // October 2026 cycle

  return (
    <div className="space-y-6">
      {/* Sandbox disclaimer banner */}
      <DemoDisclaimer moduleName="dashboard" />

      {/* Primary KPI Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        <StatCard
          title="Total Workforce"
          value="154"
          trend={{ value: '+4 this month', positive: true }}
          subtext="across 6 departments"
          icon={<Users className="w-5 h-5" />}
          iconBgColor="bg-indigo-50 text-indigo-600"
        />

        <StatCard
          title="Present Today"
          value="147"
          trend={{ value: '95.4% rate', positive: true }}
          subtext="126 on-site • 21 remote"
          icon={<Clock className="w-5 h-5" />}
          iconBgColor="bg-emerald-50 text-emerald-600"
        />

        <StatCard
          title="Pending Leave"
          value="3"
          trend={{ value: 'Needs Review', neutral: true }}
          subtext="1 medical, 2 personal"
          icon={<CalendarOff className="w-5 h-5" />}
          iconBgColor="bg-amber-50 text-amber-600"
        />

        <StatCard
          title="Latest Payroll"
          value={formatCurrency(currentPayroll.totalNet)}
          trend={{ value: currentPayroll.status, positive: true }}
          subtext={`Cycle: ${currentPayroll.periodName.split(' ')[0]} 2026`}
          icon={<Banknote className="w-5 h-5" />}
          iconBgColor="bg-sky-50 text-sky-600"
        />
      </div>

      {/* Analytics Visualizations */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Attendance Trends Bar Chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Attendance Trends</CardTitle>
              <CardDescription>Daily present vs remote workforce logs for the current work week</CardDescription>
            </div>
            <Link
              to="/attendance"
              className="text-xs font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1"
            >
              View Log <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </CardHeader>
          <CardContent>
            <div className="h-64 sm:h-72 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={mockWeeklyAttendanceData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1e293b',
                      borderRadius: '8px',
                      color: '#f8fafc',
                      fontSize: '12px',
                      border: 'none',
                    }}
                  />
                  <Bar dataKey="present" fill="#4f46e5" radius={[4, 4, 0, 0]} name="On-Site" />
                  <Bar dataKey="remote" fill="#818cf8" radius={[4, 4, 0, 0]} name="Remote" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Department Workforce Distribution */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Department Headcount</CardTitle>
              <CardDescription>Distribution across business functions</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-64 sm:h-72 w-full flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={mockDepartmentDistribution}
                    dataKey="count"
                    nameKey="name"
                    cx="50%"
                    cy="45%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={3}
                  >
                    {mockDepartmentDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1e293b',
                      borderRadius: '8px',
                      color: '#f8fafc',
                      fontSize: '12px',
                      border: 'none',
                    }}
                  />
                  <Legend
                    verticalAlign="bottom"
                    iconSize={8}
                    wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity & Upcoming Milestones */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Audit / Operational Activity */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>Audit events and operational movements</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="divide-y divide-slate-100 p-0">
            {mockRecentActivities.map((act) => (
              <div key={act.id} className="p-4 flex items-start gap-3 hover:bg-slate-50/50 transition-colors">
                <div className="w-2 h-2 rounded-full bg-brand-500 mt-1.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-800 leading-relaxed">
                    <span className="font-semibold text-slate-900">{act.actorName}</span>{' '}
                    {act.action}{' '}
                    <span className="font-medium text-slate-900">{act.target}</span>
                  </p>
                  <span className="text-[11px] text-slate-400 mt-0.5 block">{act.timestamp}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Upcoming Birthdays & New Joiners */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Upcoming Milestones</CardTitle>
              <CardDescription>Celebrations, work anniversaries, and new team members</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="p-0 divide-y divide-slate-100">
            {mockUpcomingEvents.map((item) => {
              const iconMap = {
                birthday: <Cake className="w-4 h-4 text-pink-500" />,
                anniversary: <Award className="w-4 h-4 text-amber-500" />,
                new_joiner: <UserPlus className="w-4 h-4 text-emerald-500" />,
              };

              return (
                <div key={item.id} className="p-4 flex items-center justify-between hover:bg-slate-50/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-slate-50 border border-slate-100">
                      {iconMap[item.type]}
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-slate-900">{item.employeeName}</h4>
                      <p className="text-[11px] text-slate-500">
                        {item.jobTitle} • {item.departmentName}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-medium text-slate-700 block">{item.dateString}</span>
                    <Badge variant="neutral" size="sm" className="mt-0.5 text-[10px]">
                      {item.relativeBadge}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
