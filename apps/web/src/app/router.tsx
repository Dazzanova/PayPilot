import { createBrowserRouter } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { ProtectedRoute } from '../components/auth/ProtectedRoute';
import { AppLayout } from '../components/layout/AppLayout';
import { LoginPage } from '../pages/LoginPage';
import { NotFoundPage } from '../pages/NotFoundPage';

// Lazy load pages for code splitting
const DashboardPage = lazy(() => import('../pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const EmployeesPage = lazy(() => import('../pages/EmployeesPage').then(m => ({ default: m.EmployeesPage })));
const AttendancePage = lazy(() => import('../pages/AttendancePage').then(m => ({ default: m.AttendancePage })));
const LeavePage = lazy(() => import('../pages/LeavePage').then(m => ({ default: m.LeavePage })));
const PayrollPage = lazy(() => import('../pages/PayrollPage').then(m => ({ default: m.PayrollPage })));
const PayrollImportsPage = lazy(() => import('../pages/PayrollImportsPage').then(m => ({ default: m.PayrollImportsPage })));
const PayrollImportDetailPage = lazy(() => import('../pages/PayrollImportDetailPage').then(m => ({ default: m.PayrollImportDetailPage })));
const DepartmentsPage = lazy(() => import('../pages/DepartmentsPage').then(m => ({ default: m.DepartmentsPage })));
const SettingsPage = lazy(() => import('../pages/SettingsPage').then(m => ({ default: m.SettingsPage })));

const LoadingFallback = () => (
  <div className="flex items-center justify-center h-screen">
    <div className="animate-spin w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full" />
  </div>
);

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      {
        index: true,
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <DashboardPage />
          </Suspense>
        ),
      },
      {
        path: 'employees',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <EmployeesPage />
          </Suspense>
        ),
      },
      {
        path: 'attendance',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <AttendancePage />
          </Suspense>
        ),
      },
      {
        path: 'leave',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <LeavePage />
          </Suspense>
        ),
      },
      {
        path: 'payroll',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <PayrollPage />
          </Suspense>
        ),
      },
      {
        path: 'payroll/imports',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <PayrollImportsPage />
          </Suspense>
        ),
      },
      {
        path: 'payroll/imports/:id',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <PayrollImportDetailPage />
          </Suspense>
        ),
      },
      {
        path: 'departments',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <DepartmentsPage />
          </Suspense>
        ),
      },
      {
        path: 'settings',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <SettingsPage />
          </Suspense>
        ),
      },
      {
        path: '*',
        element: <NotFoundPage />,
      },
    ],
  },
]);
