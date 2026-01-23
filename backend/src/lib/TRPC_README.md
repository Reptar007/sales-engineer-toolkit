# Universal tRPC Setup

This directory contains the universal tRPC configuration that can be used across all projects in the Sales Engineer Toolkit.

## Structure

- `lib/trpc.js` - Core tRPC setup (context, procedures, router creation)
- `routes/trpc.js` - Express adapter for tRPC
- `routes/trpc-router.js` - Main router that combines all project routers

## How to Add a Project Router

1. **Create a router file in your project:**

   ```javascript
   // backend/src/projects/your-project/trpc.js
   import { router, publicProcedure, protectedProcedure } from '../../lib/trpc.js';
   import { z } from 'zod';

   export const yourProjectRouter = router({
     // Your procedures here
     getData: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
       // Your logic here
       return { data: 'example' };
     }),
   });
   ```

2. **Import and add to main router:**

   ```javascript
   // backend/src/routes/trpc-router.js
   import { yourProjectRouter } from '../projects/your-project/trpc.js';

   export const appRouter = router({
     yourProject: yourProjectRouter,
     // ... other routers
   });
   ```

## Available Procedures

### `publicProcedure`

- Can be called without authentication
- Use for public endpoints

### `protectedProcedure`

- Requires authentication
- User info available in `ctx.user`
- Throws `UNAUTHORIZED` if not authenticated

### `adminProcedure`

- Requires admin role
- Throws `FORBIDDEN` if user doesn't have admin role

### `roleProcedure(allowedRoles)`

- Custom role-based procedure
- Example: `roleProcedure(['sales_engineer_1', 'sales_engineer_2'])`

## Context

The tRPC context includes:

- `req` - Express request object
- `res` - Express response object
- `user` - Authenticated user (if logged in)
- `prisma` - Prisma client instance

## Usage Examples

### Frontend (when tRPC client is set up)

```typescript
// Query example
const data = await trpc.codeSummaryPdf.readSheet.query({
  spreadsheetId: 'abc123',
  range: 'Sheet1!A1:B10'
});

// Mutation example
const result = await trpc.yourProject.updateData.mutate({
  id: '123',
  data: { ... }
});
```

### Backend (in procedures)

```javascript
export const myRouter = router({
  getData: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ input, ctx }) => {
    // ctx.user is available
    // ctx.prisma is available
    const data = await ctx.prisma.user.findUnique({
      where: { id: input.id },
    });
    return data;
  }),
});
```

## Endpoints

- **HTTP**: `POST /api/trpc/{procedurePath}`
- **Example**: `POST /api/trpc/codeSummaryPdf.readSheet`

## Next Steps

1. Set up tRPC client on the frontend
2. Add more project routers as needed
3. Use type inference for full TypeScript support
