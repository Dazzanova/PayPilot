import { Router } from 'express';
import { healthRouter } from './health.routes';
import { authRouter } from './auth.routes';
import { employeesRouter } from './employees.routes';
import { departmentsRouter } from './departments.routes';
import { payrollImportsRouter } from '../features/payrollImport/payrollImport.routes';
import { attendanceRouter } from '../features/attendance/attendance.routes';
import { leaveRouter } from '../features/leave/leave.routes';
import {
  payrollDeductionRulesRouter,
  payrollRunsRouter,
  payslipsRouter,
} from '../features/payroll/payroll.routes';
import {
  payrollProfessionalTaxRouter,
  payrollStatutorySettingsRouter,
  payrollTaxSlabsRouter,
} from '../features/payroll/payrollTax.routes';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/employees', employeesRouter);
apiRouter.use('/departments', departmentsRouter);
apiRouter.use('/payroll-imports', payrollImportsRouter);
apiRouter.use('/attendance', attendanceRouter);
apiRouter.use('/leave-requests', leaveRouter);
apiRouter.use('/payroll-runs', payrollRunsRouter);
apiRouter.use('/payslips', payslipsRouter);
apiRouter.use('/payroll-deduction-rules', payrollDeductionRulesRouter);
apiRouter.use('/payroll-tax-slabs', payrollTaxSlabsRouter);
apiRouter.use('/payroll-statutory-settings', payrollStatutorySettingsRouter);
apiRouter.use('/payroll-professional-tax', payrollProfessionalTaxRouter);

apiRouter.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'PayPilot HRMS & Payroll API Service',
    version: '0.1.0',
    docs: '/api/health',
  });
});
