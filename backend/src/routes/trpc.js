/**
 * tRPC Express Adapter
 * This sets up tRPC endpoints that can be accessed via HTTP
 */

import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { createContext } from '../lib/trpc.js';
import { appRouter } from './trpc-router.js';

/**
 * Create tRPC Express middleware
 * This handles all tRPC requests at /api/trpc/*
 */
export const trpcMiddleware = createExpressMiddleware({
  router: appRouter,
  createContext,
  onError: ({ error, path }) => {
    console.error(`tRPC Error on path "${path}":`, error);
  },
});
