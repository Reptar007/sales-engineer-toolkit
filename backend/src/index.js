import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import serveStatic from 'serve-static';

// Import routes
import apiRoutes from './routes/api.js';

// Import middleware
import { requestLogger, apiLogger } from './middleware/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

// Load environment variables
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });
dotenv.config({ path: resolve(__dirname, '../../.env') });
dotenv.config();

const PORT = process.env.PORT || 7071;
const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(requestLogger);
app.use(apiLogger);

// Serve static files from the frontend build directory
const frontendDistPath = resolve(__dirname, '../../frontend/dist');
console.log('Frontend dist path:', frontendDistPath);

try {
  app.use(serveStatic(frontendDistPath));
  console.log('Static file serving enabled');
} catch (error) {
  console.warn('Static file serving disabled:', error.message);
}

// API Routes
app.use('/api', apiRoutes);

// Health check endpoint (legacy support)
app.get('/healthz', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// Catch-all handler: send back React's index.html file for any non-API routes
// Note: During development, the frontend dev server handles routing, so this is mainly for production
app.get(/^(?!\/api).*/, (req, res) => {
  // Skip API routes
  if (req.path.startsWith('/estimate') || req.path.startsWith('/healthz')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }

  const indexPath = resolve(__dirname, '../../frontend/dist/index.html');
  console.log('Serving index.html from:', indexPath);

  try {
    res.sendFile(indexPath);
  } catch (error) {
    console.error('Error serving index.html:', error.message);
    res.status(404).send('Frontend not built. Please run npm run build first.');
  }
});

// Error handling middleware
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`[sales-engineer-toolkit] Server listening on port ${PORT}`);
  console.log(`[sales-engineer-toolkit] Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`[sales-engineer-toolkit] API available at: http://localhost:${PORT}/api`);
  console.log(`[sales-engineer-toolkit] Frontend available at: http://localhost:${PORT}`);
});
