import express from 'express';
import ratioEstimatorRoutes from '../projects/ratio-estimator/routes/index.js';
import flowDocRoutes from '../projects/flow-doc-generator/routes/index.js';
import maintenanceDashboardRoutes from '../projects/maintenance-dashboard/routes/index.js';
import loneWolvesRoutes from '../projects/lone-wolves/routes/index.js';
import healthRoutes from './health.js';
import authRoutes from './auth.js';
import salesforceRoutes from '../projects/salesforce/index.js';
import teamRoutes from './teams.js';
import userRoutes from '../user.js';
import dashboardRoutes from './dashboard.js';
import integrationsRoutes from './integrations.js';
import oppsRoutes from './opps.js';
import { blockCsm } from '../middleware/rbac.js';

const router = express.Router();

// Customer success accounts (csm, csm_lead) see their self-serve clients and
// Lone Wolves, nothing built for SEs: `blockCsm` sits in front of every
// other router. It only turns away a CSM token; everyone else reaches each
// router's own auth as before.

// Mount authentication routes
router.use('/auth', authRoutes);

// Mount team routes
router.use('/teams', blockCsm, teamRoutes);

// Mount user routes
router.use('/users', blockCsm, userRoutes);

// Dashboard widgets (calendar, Linear)
router.use('/dashboard', blockCsm, dashboardRoutes);

router.use('/integrations', blockCsm, integrationsRoutes);

router.use('/opps', blockCsm, oppsRoutes);

// Mount project-specific routes
router.use('/ratio-estimator', blockCsm, ratioEstimatorRoutes);
router.use('/flow-doc', blockCsm, flowDocRoutes);
router.use('/maintenance-dashboard', blockCsm, maintenanceDashboardRoutes);
router.use('/lone-wolves', loneWolvesRoutes);
router.use('/health', healthRoutes);
router.use('/salesforce', blockCsm, salesforceRoutes);

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
      'maintenance-dashboard': '/api/maintenance-dashboard',
      'lone-wolves': '/api/lone-wolves',
      health: '/api/health',
      dashboard: '/api/dashboard',
      integrations: '/api/integrations',
      opps: '/api/opps',
    },
  });
});

export default router;
