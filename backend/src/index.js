import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import serveStatic from 'serve-static';

// Import middleware
import { requestLogger, apiLogger } from './middleware/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

// Initialize Prisma client for production (PostgreSQL) BEFORE importing routes
import { initializePrisma } from './lib/prisma.js';

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

try {
  app.use(serveStatic(frontendDistPath));
} catch (error) {
  console.warn('Static file serving disabled:', error.message);
}

// Health check endpoint (legacy support)
app.get('/healthz', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// Error handling middleware (but not catch-all yet - that comes after API routes)
app.use(notFoundHandler);
app.use(errorHandler);

// Initialize Prisma and start server
async function startServer() {
  // Initialize Prisma client if in production (PostgreSQL)
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('postgres')) {
    try {
      await initializePrisma();
      console.log('Prisma client initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Prisma client:', error);
      process.exit(1);
    }
  }

  // Import routes AFTER Prisma is initialized (dynamic import)
  const { default: apiRoutes } = await import('./routes/api.js');

  // API Routes - register BEFORE catch-all
  app.use('/api', apiRoutes);

  // Catch-all handler: send back React's index.html file for any non-API routes
  // This MUST be registered AFTER API routes to avoid intercepting API requests
  app.get(/^(?!\/api).*/, (req, res) => {
    // Skip API routes and health check
    if (req.path.startsWith('/estimate') || req.path.startsWith('/healthz')) {
      return res.status(404).json({ error: 'API endpoint not found' });
    }

    const indexPath = resolve(__dirname, '../../frontend/dist/index.html');

    try {
      res.sendFile(indexPath);
    } catch (error) {
      console.error('Error serving index.html:', error.message);
      res.status(404).send('Frontend not built. Please run npm run build first.');
    }
  });

  // Start server
  app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
  });
}

startServer();
