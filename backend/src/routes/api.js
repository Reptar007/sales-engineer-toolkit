import express from 'express';
import ratioEstimatorRoutes from '../projects/ratio-estimator/routes/index.js';
import healthRoutes from './health.js';
import authRoutes from './auth.js';
import salesforceRoutes from '../projects/salesforce/index.js';
import teamRoutes from './teams.js';
import userRoutes from '../user.js';
import codeSummaryPdfRoutes from '../projects/code-summary-pdf/routes/index.js';

const router = express.Router();

// Mount authentication routes
router.use('/auth', authRoutes);

// Mount team routes
router.use('/teams', teamRoutes);

// Mount user routes
router.use('/users', userRoutes);

// Mount project-specific routes
router.use('/ratio-estimator', ratioEstimatorRoutes);
router.use('/health', healthRoutes);
router.use('/salesforce', salesforceRoutes);
router.use('/code-summary-pdf', codeSummaryPdfRoutes);

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
      health: '/api/health',
    },
  });
});

export default router;
