import express from 'express';
import ratioEstimatorRoutes from '../projects/ratio-estimator/routes/index.js';
import flowDocRoutes from '../projects/flow-doc-generator/routes/index.js';
import healthRoutes from './health.js';
import authRoutes from './auth.js';
import salesforceRoutes from '../projects/salesforce/index.js';
import teamRoutes from './teams.js';
import userRoutes from '../user.js';
import dashboardRoutes from './dashboard.js';
import integrationsRoutes from './integrations.js';

const router = express.Router();

// Mount authentication routes
router.use('/auth', authRoutes);

// Mount team routes
router.use('/teams', teamRoutes);

// Mount user routes
router.use('/users', userRoutes);

// Dashboard widgets (calendar, Linear)
router.use('/dashboard', dashboardRoutes);

router.use('/integrations', integrationsRoutes);

// Mount project-specific routes
router.use('/ratio-estimator', ratioEstimatorRoutes);
router.use('/flow-doc', flowDocRoutes);
router.use('/health', healthRoutes);
router.use('/salesforce', salesforceRoutes);

// API root endpoint
router.get('/', (req, res) => {
  res.json({
    message: 'Sales Engineer Toolkit API',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      teams: '/api/teams',
      users: '/api/users',
      salesforce: '/api/salesforce',
      'ratio-estimator': '/api/ratio-estimator',
      'flow-doc': '/api/flow-doc',
      health: '/api/health',
      dashboard: '/api/dashboard',
      integrations: '/api/integrations',
    },
  });
});

export default router;
