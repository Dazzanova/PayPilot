import { Router } from 'express';
import { healthRouter } from './health.routes';
import { authRouter } from './auth.routes';
import { employeesRouter } from './employees.routes';
import { departmentsRouter } from './departments.routes';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/employees', employeesRouter);
apiRouter.use('/departments', departmentsRouter);

apiRouter.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'PayPilot HRMS & Payroll API Service',
    version: '0.1.0',
    docs: '/api/health',
  });
});
