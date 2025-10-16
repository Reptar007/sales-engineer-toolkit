import express from 'express';
import ratioEstimatorRoutes from '../projects/ratio-estimator/routes/index.js';
import healthRoutes from './health.js';
import authRoutes from './auth.js';

const router = express.Router();

// Mount authentication routes
router.use('/auth', authRoutes);

// Mount project-specific routes
router.use('/ratio-estimator', ratioEstimatorRoutes);
router.use('/health', healthRoutes);

// API root endpoint
router.get('/', (req, res) => {
  res.json({
    message: 'Sales Engineer Toolkit API',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      'ratio-estimator': '/api/ratio-estimator',
      health: '/api/health',
    },
  });
});

export default router;
