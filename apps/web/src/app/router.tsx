import { createBrowserRouter } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { DashboardPage } from '../pages/DashboardPage';
import { EmployeesPage } from '../pages/EmployeesPage';
import { AttendancePage } from '../pages/AttendancePage';
import { LeavePage } from '../pages/LeavePage';
import { PayrollPage } from '../pages/PayrollPage';
import { DepartmentsPage } from '../pages/DepartmentsPage';
import { SettingsPage } from '../pages/SettingsPage';
import { NotFoundPage } from '../pages/NotFoundPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      {
        index: true,
        element: <DashboardPage />,
      },
      {
        path: 'employees',
        element: <EmployeesPage />,
      },
      {
        path: 'attendance',
        element: <AttendancePage />,
      },
      {
        path: 'leave',
        element: <LeavePage />,
      },
      {
        path: 'payroll',
        element: <PayrollPage />,
      },
      {
        path: 'departments',
        element: <DepartmentsPage />,
      },
      {
        path: 'settings',
        element: <SettingsPage />,
      },
      {
        path: '*',
        element: <NotFoundPage />,
      },
    ],
  },
]);
